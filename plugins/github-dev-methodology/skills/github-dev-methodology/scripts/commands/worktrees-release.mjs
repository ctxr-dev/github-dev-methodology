import { GdmError, UsageError } from "../lib/errors.mjs";
import { isGdmLock } from "../lib/worktree-ownership.mjs";
import { resolveWorktree, worktreeContaining } from "../lib/worktree-prune.mjs";
import { splitFlags, worktreeContext } from "../lib/worktrees.mjs";

function locate({ entries, ctx }, target) {
  const entry = target ? resolveWorktree(entries, target, ctx.cwd) : worktreeContaining(entries, ctx.cwd);
  if (!entry) throw new GdmError(`no worktree for ${target ?? ctx.cwd}`);
  return entry;
}

export async function run(args, ctx) {
  const { positional } = splitFlags(args);
  if (positional.length > 1) throw new UsageError("usage: gdm worktrees release [<path|branch>]");
  const context = worktreeContext(ctx);
  const entry = locate(context, positional[0]);
  if (!entry.locked) {
    ctx.stdout.write(`not locked: ${entry.path}\n`);
    return 0;
  }
  if (!isGdmLock(entry.lockReason)) throw new GdmError(`locked by another tool: ${entry.lockReason ?? "(no reason)"}`);
  const result = context.git(["worktree", "unlock", entry.path], context.id.root);
  if (result.status !== 0) throw new GdmError(`git worktree unlock failed: ${(result.stderr || result.stdout).trim()}`);
  ctx.stdout.write(`released: ${entry.path}\n`);
  return 0;
}
