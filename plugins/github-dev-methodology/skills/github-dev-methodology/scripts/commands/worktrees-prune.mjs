import { pruneCandidates, selectAllMerged, selectExplicit } from "../lib/worktree-prune.mjs";
import { splitFlags, worktreeContext } from "../lib/worktrees.mjs";
import { UsageError } from "../lib/errors.mjs";

const USAGE = "usage: gdm worktrees prune <path|branch>... | --all-merged";

function writeText(report, stdout) {
  report.removed.forEach((item) => {
    const note = item.branchKept ? ` (branch kept: ${item.branchKept})` : "";
    stdout.write(`removed: ${item.path} (${item.branch})${note}\n`);
  });
  report.kept.forEach((item) => stdout.write(`kept: ${item.path ?? item.target} (${item.reason})\n`));
}

export async function run(args, ctx) {
  const { positional, flags } = splitFlags(args, [], ["--all-merged"]);
  const allMerged = flags["--all-merged"] === true;
  if (allMerged === positional.length > 0) throw new UsageError(USAGE);
  const context = worktreeContext(ctx);
  const selection = allMerged ? selectAllMerged(context) : selectExplicit(context, positional);
  const report = await pruneCandidates(context, selection);
  if (ctx.json) ctx.stdout.write(`${JSON.stringify(report)}\n`);
  else writeText(report, ctx.stdout);
  return 0;
}
