import { parseIssueRef } from "../lib/issue-ref.mjs";
import { walkDown, walkUp } from "../lib/issue-tree.mjs";
import { parseValidateArgs } from "../lib/validate-args.mjs";
import { UsageError } from "../lib/errors.mjs";

const label = ({ owner, repo, number }) => `${owner}/${repo}#${number}`;

function reportDefects(ctx, defects) {
  for (const defect of defects) ctx.stderr.write(`tree: ${defect.kind}: ${defect.issue}: ${defect.detail}\n`);
}

function emitJson(ctx, payload) {
  ctx.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runDown(ref, ctx) {
  const { defects, total, maxDepth } = await walkDown(ctx.gh, ref);
  const ok = defects.length === 0;
  if (ctx.json) {
    emitJson(ctx, { ok, root: label(ref), issues: total, maxDepth, defects });
  } else if (ok) {
    ctx.stdout.write(`tree ok: ${total} issues under ${label(ref)}, max depth ${maxDepth}\n`);
  }
  if (!ok) reportDefects(ctx, defects);
  return ok ? 0 : 1;
}

async function runUp(ref, ctx) {
  const { chain, blockers, defects } = await walkUp(ctx.gh, ref);
  const ok = defects.length === 0;
  if (ctx.json) {
    emitJson(ctx, { ok, chain, blockers, defects });
  } else {
    ctx.stdout.write(`chain: ${chain.map((entry) => entry.issue).join(" -> ")}\n`);
    for (const blocker of blockers) {
      ctx.stdout.write(`blocked-by: ${blocker.blockedBy} "${blocker.title}" (open) blocks ${blocker.issue}\n`);
    }
  }
  if (!ok) reportDefects(ctx, defects);
  return ok ? 0 : 1;
}

export async function run(args, ctx) {
  const { positionals, flags } = parseValidateArgs(args, { booleans: ["up"] });
  if (positionals.length !== 1) throw new UsageError("usage: gdm validate tree <issue-url> [--up]");
  const ref = parseIssueRef(positionals[0]);
  return flags.up ? runUp(ref, ctx) : runDown(ref, ctx);
}
