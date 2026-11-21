import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { expandHome } from "./paths.mjs";
import { spawnGit } from "./repo-identity.mjs";

const finding = (level, message) => ({ level, message });

export function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonicalPath(parent), basename(absolute));
  }
}

export function isWithin(parent, child) {
  const base = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(base);
}

function covers(entry, worktreesRoot, env) {
  if (typeof entry !== "string" || entry === "") return false;
  return isWithin(canonicalPath(expandHome(entry, env)), canonicalPath(worktreesRoot));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function checkClaudeAccess(env, worktreesRoot) {
  const home = expandHome("~", env);
  if (!existsSync(join(home, ".claude"))) return [];
  const settings = readJson(join(home, ".claude", "settings.json"));
  const entries = settings?.permissions?.additionalDirectories;
  if (Array.isArray(entries) && entries.some((entry) => covers(entry, worktreesRoot, env))) return [];
  const entry = JSON.stringify({ permissions: { additionalDirectories: [worktreesRoot] } });
  return [finding("warn", `Claude Code will prompt for edits in ${worktreesRoot}; add to ~/.claude/settings.json: ${entry}`)];
}

function writableRootsEntries(lines) {
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("writable_roots")) continue;
    let end = index;
    while (end < lines.length - 1 && !lines[end].includes("]")) end += 1;
    const block = lines.slice(index, end + 1).join("\n");
    entries.push(...[...block.matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2]));
  }
  return entries;
}

export function checkCodexAccess(env, worktreesRoot) {
  const path = join(expandHome("~", env), ".codex", "config.toml");
  if (!existsSync(path)) return [];
  const entries = writableRootsEntries(readFileSync(path, "utf8").split("\n"));
  if (entries.some((entry) => covers(entry, worktreesRoot, env))) return [];
  const line = `writable_roots = [${JSON.stringify(worktreesRoot)}]`;
  return [finding("warn", `Codex will prompt for writes in ${worktreesRoot}; add under [sandbox_workspace_write] in ~/.codex/config.toml: ${line}`)];
}

function registeredWorktrees(root) {
  const result = spawnGit(["worktree", "list", "--porcelain"], root);
  if (result.status !== 0) return [];
  const entries = [];
  let current = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), bare: false };
      entries.push(current);
    } else if (line === "bare" && current) {
      current.bare = true;
    }
  }
  return entries.slice(1).filter((entry) => !entry.bare);
}

function clientNativeRoots(root, env) {
  const home = expandHome("~", env);
  return [join(root, ".claude", "worktrees"), join(home, ".codex", "worktrees"), join(home, ".omp", "wt")];
}

export function checkWorktreeLocations(root, env, worktreesRoot) {
  const allowed = [worktreesRoot, ...clientNativeRoots(root, env)].map(canonicalPath);
  return registeredWorktrees(root)
    .map((entry) => entry.path)
    .filter((path) => !allowed.some((base) => isWithin(base, canonicalPath(path))))
    .map((path) => finding("error", `worktree outside ${worktreesRoot}: ${path} (legacy-location); move it with gdm worktrees add or remove it`));
}
