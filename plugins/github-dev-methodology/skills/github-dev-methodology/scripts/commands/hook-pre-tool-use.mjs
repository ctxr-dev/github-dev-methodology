import { failureOutput, hookCwd, parseClient, parseHookPayload, readStdinText, verdictOutput } from "../lib/hook-io.mjs";
import { checkMerge } from "../lib/merge-guard.mjs";

function readPayload(text, ctx) {
  try {
    return parseHookPayload(text);
  } catch (error) {
    ctx.stderr.write(`gdm hook pre-tool-use: ignoring unreadable hook input: ${error.message}\n`);
    return null;
  }
}

export async function run(args, ctx) {
  const client = parseClient(args);
  const payload = readPayload(await readStdinText(ctx), ctx);
  const command = payload?.tool_input?.command;
  if (typeof command !== "string") return 0;
  try {
    const verdict = await checkMerge({
      command,
      cwd: hookCwd(payload, ctx),
      gh: ctx.gh,
      git: ctx.git,
      now: ctx.now,
      evaluatePr: ctx.evaluatePr,
      parsePrRef: ctx.parsePrRef,
      decideMerge: ctx.decideMerge,
    });
    if (verdict) ctx.stdout.write(verdictOutput(client, verdict));
  } catch (error) {
    ctx.stdout.write(failureOutput(client, error));
  }
  return 0;
}
