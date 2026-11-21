import { GdmError } from "../lib/errors.mjs";
import { findReleaseRoot } from "../lib/release-context.mjs";
import { runReleaseChecks } from "../lib/release-checks.mjs";
import { parseValidateArgs } from "../lib/validate-args.mjs";

export async function run(args, ctx) {
  parseValidateArgs(args);
  const root = findReleaseRoot(ctx.cwd);
  if (!root) throw new GdmError(`release: root: no .claude-plugin/marketplace.json found above ${ctx.cwd}; run this in the methodology repo`);
  const failures = runReleaseChecks(root);
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ ok: failures.length === 0, root, failures })}\n`);
  } else if (failures.length === 0) {
    ctx.stdout.write("release checks passed\n");
  }
  for (const { check, detail } of failures) ctx.stderr.write(`release: ${check}: ${detail}\n`);
  return failures.length === 0 ? 0 : 1;
}
