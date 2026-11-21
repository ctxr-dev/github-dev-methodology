import { inspectWorktrees, pruneBlocker, removeWorktree, splitFlags } from "../lib/worktrees.mjs";
import { UsageError } from "../lib/errors.mjs";

export async function run(args, ctx) {
  const { positional } = splitFlags(args);
  if (positional.length > 0) throw new UsageError("usage: gdm worktrees prune [--json]");
  const { git, entries } = await inspectWorktrees(ctx);
  const mainPath = entries.find((entry) => entry.main).path;
  const removed = [];
  const kept = [];
  for (const item of entries.filter((entry) => !entry.main)) {
    const blocker = pruneBlocker(item, ctx.cwd);
    if (blocker) {
      kept.push({ path: item.path, branch: item.branch, reason: blocker });
      continue;
    }
    const outcome = removeWorktree(git, mainPath, item);
    if (outcome.removed) removed.push({ path: item.path, branch: item.branch, branchKept: outcome.branchKept });
    else kept.push({ path: item.path, branch: item.branch, reason: outcome.reason });
  }
  git(["worktree", "prune"], mainPath);
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ removed, kept })}\n`);
    return 0;
  }
  removed.forEach((item) => {
    const note = item.branchKept ? ` (branch kept: ${item.branchKept})` : "";
    ctx.stdout.write(`removed: ${item.path} (${item.branch})${note}\n`);
  });
  kept.forEach((item) => ctx.stdout.write(`kept: ${item.path} (${item.reason})\n`));
  return 0;
}
