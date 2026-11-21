import { addWorktree, gitFrom, splitFlags } from "../lib/worktrees.mjs";
import { claimWorktree, defaultOwner, normalizeOwner } from "../lib/worktree-ownership.mjs";
import { UsageError } from "../lib/errors.mjs";

export async function run(args, ctx) {
  const { positional, flags } = splitFlags(args, ["--base", "--owner"]);
  if (positional.length !== 1) throw new UsageError("usage: gdm worktrees add <branch> [--base <ref>] [--owner <text>]");
  const owner = normalizeOwner(flags["--owner"] ?? defaultOwner());
  const git = gitFrom(ctx);
  const { path, id } = addWorktree({ git, branch: positional[0], base: flags["--base"], env: ctx.env, cwd: ctx.cwd });
  const warning = claimWorktree({ git, id, env: ctx.env, branch: positional[0], path, owner, now: ctx.now });
  if (warning) ctx.stderr.write(`${warning}\n`);
  ctx.stdout.write(`${path}\n`);
  return 0;
}
