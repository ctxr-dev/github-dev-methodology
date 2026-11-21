import { addWorktree, gitFrom, splitFlags } from "../lib/worktrees.mjs";
import { UsageError } from "../lib/errors.mjs";

export async function run(args, ctx) {
  const { positional, flags } = splitFlags(args, ["--base"]);
  if (positional.length !== 1) throw new UsageError("usage: gdm worktrees add <branch> [--base <ref>]");
  const path = addWorktree({
    git: gitFrom(ctx),
    branch: positional[0],
    base: flags["--base"],
    env: ctx.env,
    cwd: ctx.cwd,
  });
  ctx.stdout.write(`${path}\n`);
  return 0;
}
