import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigInvalidError, UsageError } from "./errors.mjs";
import { validateUserConfig } from "./schema-check.mjs";

const homeDirectory = (env) => env.HOME || homedir();

export function expandHome(path, env = process.env) {
  if (path === "~") return homeDirectory(env);
  return path.startsWith("~/") ? join(homeDirectory(env), path.slice(2)) : path;
}

export function gdmHome(env = process.env) {
  return env.GDM_HOME ? expandHome(env.GDM_HOME, env) : join(homeDirectory(env), ".github-dev-methodology");
}

export function userConfigPath(env = process.env) {
  return join(gdmHome(env), "config.json");
}

export function repoConfigDir(root) {
  return join(root, ".github-dev-methodology");
}

function readOptionalJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new ConfigInvalidError(path, [error.message]);
  }
}

export function loadUserConfig(env = process.env) {
  const path = userConfigPath(env);
  const stored = readOptionalJson(path);
  if (stored === null) return { schema_version: 1, worktrees_root: join(gdmHome(env), "worktrees") };
  const errors = validateUserConfig(stored);
  if (errors.length > 0) throw new ConfigInvalidError(path, errors);
  const worktreesRoot = stored.worktrees_root ?? join(gdmHome(env), "worktrees");
  return { schema_version: 1, worktrees_root: expandHome(worktreesRoot, env) };
}

function checkSegment(label, segment) {
  if (!segment || segment === "." || segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
    throw new UsageError(`invalid ${label}: ${JSON.stringify(segment)}`);
  }
}

function checkBranch(branch) {
  if (!branch || branch.startsWith("/") || branch.includes("..") || branch.includes("\\")) {
    throw new UsageError(`invalid branch name for a worktree path: ${JSON.stringify(branch)}`);
  }
  if (branch.split("/").some((segment) => segment === "" || segment === ".")) {
    throw new UsageError(`invalid branch name for a worktree path: ${JSON.stringify(branch)}`);
  }
}

function checkIdentity({ host, owner, repo }) {
  checkSegment("host", host);
  checkSegment("owner", owner);
  checkSegment("repo", repo);
}

export function worktreePath(id, branch, env = process.env) {
  checkIdentity(id);
  checkBranch(branch);
  const { worktrees_root: root } = loadUserConfig(env);
  return join(root, id.host, id.owner, id.repo, ...branch.split("/"));
}

export function statePath(id, env = process.env, ...parts) {
  checkIdentity(id);
  parts.forEach((part) => checkSegment("state path part", part));
  return join(gdmHome(env), "state", id.host, id.owner, id.repo, ...parts);
}
