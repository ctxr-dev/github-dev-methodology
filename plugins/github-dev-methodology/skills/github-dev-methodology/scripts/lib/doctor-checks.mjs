import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRepoConfig } from "./config.mjs";
import { checkClaudeAccess, checkCodexAccess, checkWorktreeLocations } from "./doctor-client-config.mjs";
import { checkAgentsBlock, checkCopilotActivity, checkDeleteBranchOnMerge } from "./doctor-repo-warnings.mjs";
import { ConfigInvalidError, ConfigMissingError, GdmError, NotGitRepoError } from "./errors.mjs";
import { loadUserConfig } from "./paths.mjs";
import { repoRoot } from "./repo-identity.mjs";

const MINIMUM_NODE_MAJOR = 20;
const ISSUE_FLAGS = ["issue_schema", "issue_lifecycle"];
const PROJECT_FLAGS = ["plan_to_issues", "parallel_validation", "cold_start", "plan_deprecation"];
const SCOPE_NEEDS = [
  { scope: "repo", flags: ["pr_loop", ...ISSUE_FLAGS], alternatives: [] },
  { scope: "project", flags: PROJECT_FLAGS, alternatives: [] },
  { scope: "read:org", flags: PROJECT_FLAGS, alternatives: ["write:org", "admin:org"] },
];
const STACK_EXTENSION = "github/gh-stack";

const finding = (level, message) => ({ level, message });

export function parseScopes(output) {
  const match = /Token scopes:\s*(.+)/i.exec(output);
  if (!match) return null;
  return match[1].split(",").map((scope) => scope.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function checkNode(ctx) {
  const version = ctx.nodeVersion ?? process.versions.node;
  return Number(version.split(".")[0]) < MINIMUM_NODE_MAJOR
    ? [finding("error", `Node ${version} is too old; gdm needs Node ${MINIMUM_NODE_MAJOR} or newer`)]
    : [];
}

function resolveRoot(cwd) {
  try {
    return repoRoot(cwd);
  } catch (error) {
    if (error instanceof NotGitRepoError) return resolve(cwd);
    throw error;
  }
}

function loadConfigFinding(ctx) {
  try {
    return { loaded: loadRepoConfig(ctx.cwd), findings: [] };
  } catch (error) {
    if (error instanceof ConfigMissingError) return { loaded: null, findings: [finding("error", `repo config missing: ${error.message}`)] };
    if (error instanceof ConfigInvalidError) {
      return { loaded: null, findings: error.errors.map((item) => finding("error", `repo config invalid (${error.source}): ${item}`)) };
    }
    if (error instanceof GdmError) return { loaded: null, findings: [finding("error", `repo config: ${error.message}`)] };
    throw error;
  }
}

function legacyFiles(root) {
  const directories = [join(root, ".agents", "ctxr-dev"), join(root, ".claude", "memory")];
  return directories
    .filter((directory) => existsSync(directory))
    .flatMap((directory) => readdirSync(directory).filter((name) => name.endsWith(".config.local.md")).map((name) => join(directory, name)));
}

function checkLegacy(root) {
  const findings = [];
  const clone = join(root, ".agents", "ctxr-dev", "github-dev-methodology");
  if (existsSync(clone)) {
    findings.push(finding("error", `legacy clone present: ${clone}; migrate settings with gdm config migrate <config file> --write, then delete the clone`));
  }
  for (const file of legacyFiles(root)) {
    findings.push(finding("error", `legacy config present: ${file}; migrate it with: gdm config migrate ${file} --write`));
  }
  return findings;
}

async function ghFailure(action) {
  try {
    return { result: await action() };
  } catch (error) {
    if (error instanceof GdmError) return { failure: finding("error", error.message) };
    throw error;
  }
}

function missingScopes(scopes, enabled) {
  return SCOPE_NEEDS.flatMap(({ scope, flags, alternatives }) => {
    const needed = flags.filter((flag) => enabled[flag]);
    const granted = [scope, ...alternatives].some((candidate) => scopes.includes(candidate));
    if (needed.length === 0 || granted) return [];
    return [finding("error", `gh token lacks scope "${scope}" (needed by ${needed.join(", ")}); run: gh auth refresh -s ${scope}`)];
  });
}

async function checkGhAuth(ctx, loaded) {
  const { result, failure } = await ghFailure(() => ctx.gh.cli(["auth", "status"]));
  if (failure) return { usable: false, findings: [failure] };
  if (result.status !== 0) return { usable: false, findings: [finding("error", "gh is not authenticated; run: gh auth login")] };
  const scopes = parseScopes(`${result.stdout}\n${result.stderr}`);
  const findings = loaded && scopes ? missingScopes(scopes, loaded.features) : [];
  return { usable: true, findings };
}

async function checkStackExtension(ctx) {
  const { result, failure } = await ghFailure(() => ctx.gh.cli(["extension", "list"]));
  if (failure) return [failure];
  if (result.stdout.includes(STACK_EXTENSION)) return [];
  return [finding("error", `stacked_prs is on but gh extension ${STACK_EXTENSION} is missing; run: gh extension install ${STACK_EXTENSION} --pin v0.3.0`)];
}

function worktreeFindings(ctx, root) {
  try {
    const { worktrees_root: worktreesRoot } = loadUserConfig(ctx.env);
    return [
      ...checkWorktreeLocations(root, ctx.env, worktreesRoot),
      ...checkClaudeAccess(ctx.env, worktreesRoot),
      ...checkCodexAccess(ctx.env, worktreesRoot),
    ];
  } catch (error) {
    if (error instanceof ConfigInvalidError) return [finding("error", `user config invalid (${error.source}): ${error.errors.join("; ")}`)];
    throw error;
  }
}

async function repoDependentFindings(ctx, loaded, ghUsable, root) {
  const findings = [];
  if (ghUsable) {
    if (loaded.features.stacked_prs) findings.push(...(await checkStackExtension(ctx)));
    findings.push(...(await checkDeleteBranchOnMerge(ctx.gh, loaded.project)));
    if (loaded.features.copilot_review) findings.push(...(await checkCopilotActivity(ctx.gh, loaded.project)));
  }
  findings.push(...checkAgentsBlock(root));
  if (loaded.features.worktrees) findings.push(...worktreeFindings(ctx, root));
  return findings;
}

export async function runDoctorChecks(ctx) {
  const root = resolveRoot(ctx.cwd);
  const config = loadConfigFinding(ctx);
  const auth = await checkGhAuth(ctx, config.loaded);
  const findings = [...checkNode(ctx), ...config.findings, ...checkLegacy(root), ...auth.findings];
  if (config.loaded) findings.push(...(await repoDependentFindings(ctx, config.loaded, auth.usable, root)));
  return findings;
}
