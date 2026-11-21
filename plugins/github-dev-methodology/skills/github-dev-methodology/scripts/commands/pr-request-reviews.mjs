import { loadPrContext, parseArgs, requirePrRefs } from "../lib/pr-args.mjs";
import { requestConfiguredReviews } from "../lib/review-requests.mjs";

export async function run(args, ctx) {
  const { positionals, options } = parseArgs(args, { values: ["project"], flags: ["json"] });
  const { loaded, defaults } = loadPrContext(ctx, options.project);
  const [ref] = requirePrRefs(positionals, defaults, { max: 1 });
  const { configured, ignored } = await requestConfiguredReviews(ctx.gh, ref, loaded);
  if (configured.length === 0) {
    ctx.stdout.write("no reviewers configured (CI-only): nothing to request\n");
    return 0;
  }
  for (const login of ignored) ctx.stderr.write(`request-ignored: ${login}\n`);
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ requested: configured.filter((login) => !ignored.includes(login)), ignored })}\n`);
  } else if (ignored.length === 0) {
    ctx.stdout.write(`requested: ${configured.join(", ")}\n`);
  }
  return ignored.length === 0 ? 0 : 1;
}
