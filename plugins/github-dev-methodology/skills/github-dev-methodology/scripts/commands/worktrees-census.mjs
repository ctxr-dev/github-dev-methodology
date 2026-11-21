import { join } from "node:path";
import { findOrphanDirs, inspectWorktrees, splitFlags } from "../lib/worktrees.mjs";
import { UsageError } from "../lib/errors.mjs";
import { describeLock } from "../lib/worktree-ownership.mjs";

function formatAge(seconds) {
  if (seconds === null) return "-";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatLock(item) {
  if (!item.locked) return "";
  const { owner } = describeLock(item.lock, () => 0);
  if (owner === null) return `  lock: ${item.lock ?? "(no reason)"}`;
  return `  lock: owner=${owner} age=${formatAge(item.lock_age_seconds)}`;
}

function formatLine(item) {
  const label = item.main ? "main" : item.branch ?? "(detached)";
  const pr = item.pr === null ? "-" : `PR:${item.pr}`;
  const tail = item.flags.length > 0 ? `  [${item.flags.join(",")}]` : "";
  return `${item.path}  ${label}  ${pr}  ${formatAge(item.lastCommitAgeSeconds)}${tail}${formatLock(item)}`;
}

export async function run(args, ctx) {
  const { positional } = splitFlags(args);
  if (positional.length > 0) throw new UsageError("usage: gdm worktrees census [--json]");
  const { id, worktreesRoot, entries } = await inspectWorktrees(ctx);
  const repoDir = join(worktreesRoot, id.host, id.owner, id.repo);
  const orphans = findOrphanDirs(repoDir, entries.map((entry) => entry.path));
  if (ctx.json) {
    const report = { worktrees: entries, orphans: orphans.map((path) => ({ path, flags: ["orphan-dir"] })) };
    ctx.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  }
  entries.forEach((item) => ctx.stdout.write(`${formatLine(item)}\n`));
  orphans.forEach((path) => ctx.stdout.write(`${path}  [orphan-dir]\n`));
  return 0;
}
