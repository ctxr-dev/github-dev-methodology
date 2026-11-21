import { loadPrContext, parseArgs, requirePrRefs } from "../lib/pr-args.mjs";
import { decideMerge } from "../lib/merge-authority.mjs";
import { evaluatePr } from "../lib/pr-state.mjs";

async function readPrFacts(ctx, project, ref) {
  if (project.merge.authority === "human") return { ready: false, author: null, reasons: [] };
  return evaluatePr(ctx.gh, ref, project, ctx.now);
}

export async function run(args, ctx) {
  const { positionals, options } = parseArgs(args, { values: ["project"], flags: ["json"] });
  const { project, defaults } = loadPrContext(ctx, options.project);
  const [ref] = requirePrRefs(positionals, defaults, { max: 1 });
  const facts = await readPrFacts(ctx, project, ref);
  const verdict = decideMerge({
    authority: project.merge.authority,
    scopes: project.merge.scopes,
    predicateReady: facts.ready,
    prAuthor: facts.author,
  });
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ ...verdict, authority: project.merge.authority, ready: facts.ready, reasons: facts.reasons })}\n`);
  } else {
    const blockers = verdict.exitCode === 3 ? `\n${facts.reasons.map((reason) => `  - ${reason}`).join("\n")}` : "";
    ctx.stdout.write(`${verdict.decision}: ${verdict.reason}${blockers}\n`);
  }
  return verdict.exitCode;
}
