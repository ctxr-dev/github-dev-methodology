import { resolve } from "node:path";
import { GdmError, UsageError } from "../lib/errors.mjs";
import { issueRef, loadManifest, orderItems, renderPlaceholders } from "../lib/plan-manifest.mjs";
import { createFieldActions } from "../lib/plan-sync-fields.mjs";
import { createPlanActions, ledgerFile, planMarker, readLedger, writeLedger } from "../lib/plan-sync-actions.mjs";

const USAGE = "usage: gdm plan sync <manifest.json> [--dry-run] [--json]";
const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(args) {
  const parsed = { manifest: null, dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") continue;
    else if (arg.startsWith("--")) throw new UsageError(`unknown flag ${arg}\n${USAGE}`);
    else if (parsed.manifest === null) parsed.manifest = arg;
    else throw new UsageError(`unexpected argument ${arg}\n${USAGE}`);
  }
  if (parsed.manifest === null) throw new UsageError(USAGE);
  return parsed;
}

function describePlan(item, repo) {
  const edges = [item.parent && `parent ${item.parent}`, item.blockedBy.length > 0 && `blocked-by ${item.blockedBy.join(",")}`].filter(Boolean);
  return `${item.key} in ${repo}${edges.length > 0 ? ` (${edges.join("; ")})` : ""}: ${item.title}`;
}

export async function run(args, ctx) {
  const { manifest: manifestArg, dryRun } = parseArgs(args);
  const manifest = loadManifest(resolve(ctx.cwd, manifestArg));
  const ordered = orderItems(manifest.items);
  const sleep = ctx.sleep ?? defaultSleep;
  const log = (message) => ctx.stderr.write(`${message}\n`);
  const fieldsApi = createFieldActions(ctx.gh, { pace: () => actions.pace(), log });
  const actions = createPlanActions(ctx.gh, { sleep });
  const file = ledgerFile(manifest.repo, manifest.planId, ctx.env);
  const ledger = readLedger(file);
  const knownKeys = new Set(manifest.items.map((item) => item.key));
  const urls = new Map(manifest.items.filter((item) => ledger[item.key]).map((item) => [item.key, ledger[item.key]]));
  const results = [];

  const record = (key, status, detail) => {
    results.push({ key, status, ...detail });
    if (!ctx.json) {
      const stream = status === "failed" ? ctx.stderr : ctx.stdout;
      stream.write(`${status} ${detail.text}\n`);
    }
  };

  function dependencyUrl(dependencyKey) {
    const url = urls.get(dependencyKey);
    if (!url) throw new GdmError(`dependency ${dependencyKey} has no issue yet`);
    return url;
  }

  const dependencyUrls = (item) => ({
    parentUrl: item.parent ? dependencyUrl(item.parent) : null,
    blockedByUrls: item.blockedBy.map(dependencyUrl),
  });

  function renderBody(item, repo) {
    const resolveKey = (key) => {
      const url = urls.get(key);
      if (url) return issueRef(url, repo);
      return dryRun && knownKeys.has(key) ? `<${key}>` : null;
    };
    const { text, missing } = renderPlaceholders(item.body, resolveKey);
    if (missing.length > 0) throw new GdmError(`unresolved placeholder ${missing.map((key) => `{{${key}}}`).join(", ")}`);
    return `${text.trimEnd()}\n\n${planMarker(manifest.planId, item.key)}\n`;
  }

  async function applyFieldsAndProject(item, repo, issueId) {
    const owner = repo.split("/")[0];
    let projectFields = item.projectFields;
    if (Object.keys(item.fields).length > 0) {
      const outcome = await fieldsApi.ensureIssueFields(issueId, owner, item.fields);
      if (outcome.unavailable) {
        if (!manifest.projectUrl) throw new GdmError(`issue fields unavailable for ${owner} and the manifest has no project_url`);
        projectFields = { ...item.fields, ...projectFields };
      }
    }
    if (manifest.projectUrl) await fieldsApi.syncProject(manifest.projectUrl, issueId, projectFields);
  }

  async function syncExisting(item, repo, url) {
    const { issueId } = await actions.ensureEdges(url, dependencyUrls(item));
    await applyFieldsAndProject(item, repo, issueId);
  }

  async function syncCreated(item, repo, url) {
    const needsIssueId = Object.keys(item.fields).length > 0 || manifest.projectUrl;
    if (needsIssueId) await applyFieldsAndProject(item, repo, (await actions.issueState(url)).id);
  }

  async function processItem(item) {
    const repo = item.repo ?? manifest.repo;
    let url = urls.get(item.key) ?? (await actions.findByMarker(repo, manifest.planId, item.key));
    if (url) {
      if (!urls.has(item.key)) {
        urls.set(item.key, url);
        ledger[item.key] = url;
        if (!dryRun) writeLedger(file, ledger);
      }
      if (!dryRun) await syncExisting(item, repo, url);
      return record(item.key, "existing", { url, text: `${item.key} ${url}` });
    }
    const body = renderBody(item, repo);
    if (dryRun) return record(item.key, "would-create", { text: describePlan(item, repo) });
    url = await actions.createIssue(item, repo, body, dependencyUrls(item));
    urls.set(item.key, url);
    ledger[item.key] = url;
    writeLedger(file, ledger);
    try {
      await syncCreated(item, repo, url);
    } catch (error) {
      throw new GdmError(`created ${url} but ${error.message}`);
    }
    return record(item.key, "created", { url, text: `${item.key} ${url}` });
  }

  for (const item of ordered) {
    try {
      await processItem(item);
    } catch (error) {
      record(item.key, "failed", { error: error.message, text: `${item.key}: ${error.message}` });
    }
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  const summary = dryRun
    ? `dry-run: ${count("would-create")} would be created, ${count("existing")} existing, ${count("failed")} failed`
    : `${count("created")} created, ${count("existing")} existing, ${count("failed")} failed`;
  if (ctx.json) ctx.stdout.write(`${JSON.stringify({ plan_id: manifest.planId, dry_run: dryRun, summary, items: results })}\n`);
  else ctx.stdout.write(`${summary}\n`);
  return count("failed") > 0 ? 1 : 0;
}
