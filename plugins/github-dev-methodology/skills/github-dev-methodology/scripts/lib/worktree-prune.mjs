import { resolve } from "node:path";
import { deleteOwnerRecord, readOwnerRecord } from "./worktree-ownership.mjs";
import { canonicalPath, isClientManaged, isInside, removeEmptyParents } from "./worktree-paths.mjs";
import { inspectEntry, pruneBlocker, removeWorktree } from "./worktrees.mjs";

export function resolveWorktree(entries, target, cwd) {
  const wanted = canonicalPath(resolve(cwd, target));
  return entries.find((entry) => canonicalPath(entry.path) === wanted) ?? entries.find((entry) => entry.branch === target) ?? null;
}

export function worktreeContaining(entries, cwd) {
  const containing = entries.filter((entry) => isInside(cwd, entry.path));
  const depth = (entry) => canonicalPath(entry.path).length;
  return containing.sort((left, right) => depth(right) - depth(left))[0] ?? null;
}

const mainPathOf = ({ entries }) => entries.find((entry) => entry.main).path;

function heldReason(entry, context) {
  if (entry.main) return "main worktree";
  return isClientManaged(entry.path, mainPathOf(context), context.ctx.env) ? "client-managed worktree" : null;
}

export function selectExplicit(context, targets) {
  const candidates = [];
  const kept = [];
  const seen = new Set();
  for (const target of targets) {
    const entry = resolveWorktree(context.entries, target, context.ctx.cwd);
    if (!entry) {
      kept.push({ path: null, branch: null, target, reason: `no worktree for ${target}` });
      continue;
    }
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    const reason = heldReason(entry, context);
    if (reason) kept.push({ path: entry.path, branch: entry.branch, reason });
    else candidates.push(entry);
  }
  return { candidates, kept, skipped: [] };
}

function skipReason(entry, context) {
  if (!isInside(entry.path, context.worktreesRoot)) return "outside worktrees_root";
  if (isClientManaged(entry.path, mainPathOf(context), context.ctx.env)) return "client-managed worktree";
  if (!readOwnerRecord(context.id, context.ctx.env, entry)) return "not created by gdm";
  if (entry.locked) return `locked${entry.lockReason ? ` (${entry.lockReason})` : ""}`;
  return null;
}

export function selectAllMerged(context) {
  const candidates = [];
  const skipped = [];
  for (const entry of context.entries.filter((item) => !item.main)) {
    const reason = skipReason(entry, context);
    if (reason) skipped.push({ path: entry.path, branch: entry.branch, reason });
    else candidates.push(entry);
  }
  return { candidates, kept: [], skipped };
}

function forgetRemoved(item, { ctx, id, worktreesRoot }) {
  if (item.flags.includes("gdm-owned")) deleteOwnerRecord(id, ctx.env, item.branch);
  removeEmptyParents(item.path, worktreesRoot);
}

export async function pruneCandidates(context, selection) {
  const mainPath = mainPathOf(context);
  const removed = [];
  const kept = [...selection.kept];
  for (const entry of selection.candidates) {
    const item = await inspectEntry(entry, context);
    const blocker = pruneBlocker(item, context.ctx.cwd);
    const outcome = blocker ? { removed: false, reason: blocker } : removeWorktree(context.git, mainPath, item);
    if (!outcome.removed) {
      kept.push({ path: item.path, branch: item.branch, reason: outcome.reason });
      continue;
    }
    forgetRemoved(item, context);
    removed.push({ path: item.path, branch: item.branch, branchKept: outcome.branchKept });
  }
  context.git(["worktree", "prune"], mainPath);
  return { removed, kept, skipped: selection.skipped };
}
