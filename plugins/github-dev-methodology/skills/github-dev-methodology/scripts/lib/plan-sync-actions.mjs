import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GdmError, GhError } from "./errors.mjs";
import { parseRepoRef } from "./plan-manifest.mjs";
import { statePath } from "./paths.mjs";

const PACE_MS = 1000;
const ISSUE_URL_IN_TEXT = /https:\/\/\S+\/issues\/\d+/;

const ISSUE_STATE_QUERY = `query IssueState($url: URI!) {
  resource(url: $url) {
    ... on Issue {
      id
      url
      parent { url }
      blockedBy(first: 100) { nodes { url } }
    }
  }
}`;

const ADD_BLOCKED_BY_MUTATION = `mutation AddBlockedBy($issueId: ID!, $blockingIssueId: ID!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) { clientMutationId }
}`;

export const planMarker = (planId, key) => `<!-- gdm:plan=${planId}:${key} -->`;

export function ledgerFile(repo, planId, env) {
  return statePath(parseRepoRef(repo), env, "plans", `${planId}.ledger.json`);
}

export function readLedger(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new GdmError(`cannot read ledger ${file}: ${error.message}`);
  }
}

export function writeLedger(file, ledger) {
  mkdirSync(dirname(file), { recursive: true });
  const staging = `${file}.tmp`;
  writeFileSync(staging, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(staging, file);
}

function failureText(result) {
  return (result.stderr || result.stdout).trim();
}

function isAlreadyApplied(error) {
  return /already/i.test(error.message);
}

export function createPlanActions(gh, { sleep }) {
  let wrote = false;

  async function pace() {
    if (wrote) await sleep(PACE_MS);
    wrote = true;
  }

  async function runCli(args) {
    const result = await gh.cli(args);
    if (result.status !== 0) throw new GhError(failureText(result) || `gh ${args.join(" ")} failed`, result);
    return result;
  }

  async function findByMarker(repo, planId, key) {
    const marker = planMarker(planId, key);
    const search = `gdm:plan=${planId}:${key} in:body`;
    const { stdout } = await runCli(["issue", "list", "--repo", repo, "--state", "all", "--search", search, "--json", "url,body", "--limit", "20"]);
    const match = JSON.parse(stdout || "[]").find((issue) => (issue.body ?? "").includes(marker));
    return match?.url ?? null;
  }

  async function createIssue(item, repo, body, { parentUrl, blockedByUrls }) {
    const workDir = mkdtempSync(join(tmpdir(), "gdm-plan-"));
    const bodyFile = join(workDir, "body.md");
    writeFileSync(bodyFile, body);
    try {
      const args = ["issue", "create", "--repo", repo, "--title", item.title, "--body-file", bodyFile];
      if (item.type) args.push("--type", item.type);
      item.labels.forEach((label) => args.push("--label", label));
      if (parentUrl) args.push("--parent", parentUrl);
      if (blockedByUrls.length > 0) args.push("--blocked-by", blockedByUrls.join(","));
      await pace();
      const { stdout } = await runCli(args);
      const url = ISSUE_URL_IN_TEXT.exec(stdout)?.[0];
      if (!url) throw new GhError(`gh issue create printed no issue URL: ${stdout.trim()}`);
      return url;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async function issueState(url) {
    const data = await gh.graphql(ISSUE_STATE_QUERY, { url });
    const issue = data?.resource;
    if (!issue?.id) throw new GdmError(`issue not found: ${url}`);
    return { id: issue.id, parent: issue.parent?.url ?? null, blockedBy: (issue.blockedBy?.nodes ?? []).map((node) => node.url) };
  }

  async function ensureParent(url, state, parentUrl) {
    if (!parentUrl || state.parent === parentUrl) return 0;
    await pace();
    const result = await gh.cli(["issue", "edit", url, "--parent", parentUrl]);
    if (result.status !== 0 && !isAlreadyApplied(new Error(failureText(result)))) {
      throw new GhError(failureText(result) || `gh issue edit ${url} failed`, result);
    }
    return 1;
  }

  async function ensureBlockers(state, blockedByUrls) {
    let added = 0;
    for (const blockerUrl of blockedByUrls.filter((url) => !state.blockedBy.includes(url))) {
      const blocker = await issueState(blockerUrl);
      await pace();
      try {
        await gh.graphql(ADD_BLOCKED_BY_MUTATION, { issueId: state.id, blockingIssueId: blocker.id });
        added += 1;
      } catch (error) {
        if (!isAlreadyApplied(error)) throw error;
      }
    }
    return added;
  }

  async function ensureEdges(url, { parentUrl, blockedByUrls }) {
    const state = await issueState(url);
    const parentFixed = await ensureParent(url, state, parentUrl);
    const blockersAdded = await ensureBlockers(state, blockedByUrls);
    return { issueId: state.id, edgesWritten: parentFixed + blockersAdded };
  }

  return { pace, findByMarker, createIssue, issueState, ensureEdges };
}
