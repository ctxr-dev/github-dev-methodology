import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { GdmError, UsageError } from "./errors.mjs";
import { repoIdentity, spawnGit } from "./repo-identity.mjs";
import { loadUserConfig, worktreePath } from "./paths.mjs";
import { describeLock, readOwnerRecord } from "./worktree-ownership.mjs";
import { canonicalPath, isInside } from "./worktree-paths.mjs";

const PR_STATE_PRIORITY = ["OPEN", "MERGED", "CLOSED"];

export function gitFrom(ctx) {
  return ctx.git ?? spawnGit;
}

export function splitFlags(args, valueFlags = [], switchFlags = []) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--json") continue;
    if (switchFlags.includes(token)) {
      flags[token] = true;
      continue;
    }
    const flag = valueFlags.find((name) => token === name || token.startsWith(`${name}=`));
    if (flag) {
      const inline = token.startsWith(`${flag}=`);
      const value = inline ? token.slice(flag.length + 1) : args[index + 1];
      if (!value) throw new UsageError(`${flag} needs a value`);
      flags[flag] = value;
      if (!inline) index += 1;
    } else if (token.startsWith("--")) {
      throw new UsageError(`unknown flag: ${token}`);
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function gitOrThrow(git, args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new GdmError(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

export function parseWorktreeList(porcelain) {
  return porcelain
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const entry = { path: null, head: null, branch: null, bare: false, locked: false, lockReason: null, prunable: false, main: index === 0 };
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "worktree") entry.path = value;
        else if (key === "HEAD") entry.head = value;
        else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
        else if (key === "bare") entry.bare = true;
        else if (key === "prunable") entry.prunable = true;
        else if (key === "locked") Object.assign(entry, { locked: true, lockReason: value || null });
      }
      return entry;
    })
    .filter((entry) => entry.path);
}

export function listWorktrees(git, root) {
  return parseWorktreeList(gitOrThrow(git, ["worktree", "list", "--porcelain"], root));
}

function defaultBaseRef(git, root) {
  const result = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], root);
  const ref = result.stdout.trim();
  if (result.status !== 0 || ref === "") {
    throw new GdmError("cannot determine the default branch: run `git remote set-head origin -a` or pass --base <ref>");
  }
  return ref.replace(/^refs\/remotes\//, "");
}

function refResolves(git, root, ref) {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root).status === 0;
}

function localBranchExists(git, root, branch) {
  return git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).status === 0;
}

export function addWorktree({ git, branch, base, env, cwd }) {
  const id = repoIdentity(cwd, git);
  const path = worktreePath(id, branch, env);
  if (existsSync(path)) throw new GdmError(`worktree path exists: ${path}`);
  gitOrThrow(git, ["fetch", "origin"], id.root);
  const reuse = localBranchExists(git, id.root, branch);
  if (reuse && base) throw new UsageError(`branch ${branch} already exists; --base only applies to a new branch`);
  mkdirSync(dirname(path), { recursive: true });
  if (reuse) {
    gitOrThrow(git, ["worktree", "add", path, branch], id.root);
    return { path, id };
  }
  const startPoint = base ?? defaultBaseRef(git, id.root);
  if (!refResolves(git, id.root, startPoint)) throw new GdmError(`base ref not found: ${startPoint}`);
  gitOrThrow(git, ["worktree", "add", path, "-b", branch, startPoint], id.root);
  return { path, id };
}

export function worktreeStatus(entry, git, now) {
  const exists = existsSync(entry.path);
  const state = { exists, dirty: null, lastCommitAgeSeconds: null };
  if (!exists) return state;
  const status = git(["status", "--porcelain"], entry.path);
  if (status.status === 0) state.dirty = status.stdout.trim() !== "";
  const log = git(["log", "-1", "--format=%ct"], entry.path);
  const committed = Number(log.stdout.trim());
  if (log.status === 0 && Number.isFinite(committed) && log.stdout.trim() !== "") {
    state.lastCommitAgeSeconds = Math.max(0, Math.floor(now() / 1000 - committed));
  }
  return state;
}

export async function prStateFor(gh, id, branch) {
  const slug = `${id.host}/${id.owner}/${id.repo}`;
  const result = await gh.cli(["pr", "list", "--repo", slug, "--head", branch, "--state", "all", "--json", "state"]);
  if (result.status !== 0) return "UNKNOWN";
  let items;
  try {
    items = JSON.parse(result.stdout.trim() || "[]");
  } catch {
    return "UNKNOWN";
  }
  const states = new Set(items.map((item) => item.state));
  return PR_STATE_PRIORITY.find((state) => states.has(state)) ?? "NONE";
}

export async function inspectEntry(entry, { ctx, git, id, worktreesRoot }) {
  const status = worktreeStatus(entry, git, ctx.now);
  const record = readOwnerRecord(id, ctx.env, entry);
  const lock = entry.locked ? entry.lockReason : null;
  const flags = [];
  if (!status.exists || entry.prunable) flags.push("missing");
  if (entry.locked) flags.push("locked");
  if (status.dirty) flags.push("dirty");
  if (!entry.main && !isInside(entry.path, worktreesRoot)) flags.push("legacy-location");
  if (record) flags.push("gdm-owned");
  const pr = entry.main || !entry.branch ? null : await prStateFor(ctx.gh, id, entry.branch);
  return {
    path: entry.path,
    branch: entry.branch,
    main: entry.main,
    locked: entry.locked,
    lock,
    owner: record?.owner ?? null,
    lock_age_seconds: describeLock(lock, ctx.now).ageSeconds,
    ...status,
    pr,
    flags,
  };
}

export function worktreeContext(ctx) {
  const git = gitFrom(ctx);
  const id = repoIdentity(ctx.cwd, git);
  const { worktrees_root: worktreesRoot } = loadUserConfig(ctx.env);
  return { ctx, git, id, worktreesRoot, entries: listWorktrees(git, id.root) };
}

export async function inspectWorktrees(ctx) {
  const context = worktreeContext(ctx);
  const inspected = [];
  for (const entry of context.entries) inspected.push(await inspectEntry(entry, context));
  return { ...context, entries: inspected };
}

function hasWorktreeMarker(dir) {
  return existsSync(join(dir, ".git"));
}

export function findOrphanDirs(repoDir, registeredPaths) {
  if (!existsSync(repoDir)) return [];
  const registered = new Set(registeredPaths.map(canonicalPath));
  const orphans = [];
  const visit = (dir) => {
    const children = readdirSync(dir, { withFileTypes: true });
    if (hasWorktreeMarker(dir)) {
      if (!registered.has(canonicalPath(dir))) orphans.push(dir);
      return;
    }
    if (children.some((child) => !child.isDirectory())) {
      orphans.push(dir);
      return;
    }
    children.forEach((child) => visit(join(dir, child.name)));
  };
  visit(repoDir);
  return orphans;
}

export function pruneBlocker(item, cwd) {
  if (!item.branch) return "detached HEAD";
  if (item.locked) return `locked${item.lock ? ` (${item.lock})` : ""}; run gdm worktrees release first`;
  if (!item.exists) return "path missing";
  if (item.dirty === null) return "status unavailable";
  if (item.dirty) return "dirty";
  if (item.pr !== "MERGED") return item.pr === "NONE" ? "no PR" : `PR ${item.pr.toLowerCase()}`;
  if (isInside(cwd, item.path)) return "current directory is inside this worktree";
  return null;
}

export function removeWorktree(git, mainPath, item) {
  const removal = git(["worktree", "remove", item.path], mainPath);
  if (removal.status !== 0) return { removed: false, reason: removal.stderr.trim().split("\n")[0] || "git worktree remove failed" };
  const branch = git(["branch", "-d", item.branch], mainPath);
  const branchKept = branch.status === 0 ? null : branch.stderr.trim().split("\n")[0] || "git branch -d failed";
  return { removed: true, branchKept };
}
