import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMethodologyBlock } from "../lib/agents-md.mjs";
import { ConfigInvalidError, UsageError } from "../lib/errors.mjs";
import { PRESETS } from "../lib/features.mjs";
import { repoConfigDir } from "../lib/paths.mjs";
import { repoRoot } from "../lib/repo-identity.mjs";
import { validateRepoConfig } from "../lib/schema-check.mjs";
import { readAsset, readAssetJson } from "../lib/setup-assets.mjs";
import { parseFlags } from "../lib/setup-args.mjs";

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOCAL_CONFIG_IGNORE = "config.local.json\n";

function readInputs(args) {
  const { options, positionals } = parseFlags(args, { values: ["preset", "org", "repo", "project"] });
  if (positionals.length > 0) throw new UsageError(`init takes no positional arguments: ${positionals.join(" ")}`);
  const { preset, org, repo } = options;
  if (!preset || !org || !repo) throw new UsageError("usage: gdm init --preset <pr-only|single-issue|full> --org <org> --repo <repo> [--project <slug>]");
  if (!Object.hasOwn(PRESETS, preset)) {
    throw new UsageError(`unknown preset "${preset}"; expected one of ${Object.keys(PRESETS).join(", ")}`);
  }
  const project = options.project ?? repo;
  if (!SLUG_PATTERN.test(project)) throw new UsageError(`invalid project slug: ${JSON.stringify(project)}`);
  return { preset, org, repo, project };
}

function buildConfig({ preset, org, repo, project }) {
  const template = readAssetJson("config.template.json");
  const [templateProject] = Object.values(template.projects);
  const config = {
    ...template,
    active_project: project,
    projects: { [project]: { ...templateProject, preset, org, primary_repo: repo } },
  };
  const errors = validateRepoConfig(config);
  if (errors.length > 0) throw new ConfigInvalidError("generated config", errors);
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeIfAbsent(path, content, label, report) {
  if (existsSync(path)) {
    report.kept.push(label);
    return;
  }
  writeFileSync(path, content);
  report.created.push(label);
}

function planAgentsMd(root) {
  const path = join(root, "AGENTS.md");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  const updated = ensureMethodologyBlock(existing, readAsset("agents-md-block.md"));
  const outcome = updated === existing ? "unchanged" : existing === null ? "created" : "updated";
  return { path, updated, outcome };
}

function printReport(report, ctx) {
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  report.created.forEach((label) => ctx.stdout.write(`created ${label}\n`));
  if (report.kept.includes(".github-dev-methodology/config.json")) ctx.stdout.write("config exists\n");
  if (report.kept.includes(".github-dev-methodology/.gitignore")) ctx.stdout.write(".gitignore exists\n");
  ctx.stdout.write(`AGENTS.md ${report.agents_md}\n`);
}

export async function run(args, ctx) {
  const inputs = readInputs(args);
  const root = repoRoot(ctx.cwd);
  const dir = repoConfigDir(root);
  const agentsMd = planAgentsMd(root);
  const report = { created: [], kept: [], agents_md: agentsMd.outcome };
  mkdirSync(dir, { recursive: true });
  writeIfAbsent(join(dir, "config.json"), buildConfig(inputs), ".github-dev-methodology/config.json", report);
  writeIfAbsent(join(dir, ".gitignore"), LOCAL_CONFIG_IGNORE, ".github-dev-methodology/.gitignore", report);
  if (agentsMd.outcome !== "unchanged") writeFileSync(agentsMd.path, agentsMd.updated);
  printReport(report, ctx);
  return 0;
}
