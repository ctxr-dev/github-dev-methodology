import { loadPrContext, parseArgs, positiveSeconds, requirePrRefs } from "../lib/pr-args.mjs";
import { GhMissingError } from "../lib/errors.mjs";
import { errorEntry, formatLine, jsonEntry, stateKey } from "../lib/pr-report.mjs";
import { evaluatePr, refLabel } from "../lib/pr-state.mjs";

const MAX_CONSECUTIVE_ERRORS = 3;
const EXIT_TIMEOUT = 2;
const EXIT_NOT_READY = 3;
const realSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createReporter(ctx) {
  const lastKey = new Map();
  const write = (label, key, text, entry) => {
    if (lastKey.get(label) === key) return;
    lastKey.set(label, key);
    ctx.stdout.write(ctx.json ? `${JSON.stringify(entry)}\n` : `${text}\n`);
  };
  const stamp = () => new Date(ctx.now()).toISOString();
  return {
    state: (ref, evaluation) =>
      write(refLabel(ref), stateKey(evaluation), formatLine(ref, evaluation), jsonEntry(ref, evaluation, stamp())),
    error: (ref, message) =>
      write(refLabel(ref), `error:${message}`, `${refLabel(ref)} error: ${message}`, errorEntry(ref, message, stamp())),
  };
}

function nextDeadline(elapsedSeconds, bounded, maxWait) {
  if (bounded !== null && elapsedSeconds >= bounded) return { exit: EXIT_NOT_READY, message: `not ready after ${bounded}s (bounded wait ended)` };
  if (elapsedSeconds >= maxWait) return { exit: EXIT_TIMEOUT, message: `max-wait ${maxWait}s reached without every PR ready` };
  return null;
}

export async function run(args, ctx) {
  const { positionals, options } = parseArgs(args, { values: ["bounded", "max-wait", "project"], flags: ["json"] });
  const { project, defaults } = loadPrContext(ctx, options.project);
  const refs = requirePrRefs(positionals, defaults);
  const { poll_seconds: pollSeconds, max_hours: maxHours } = project.review;
  const bounded = options.bounded === undefined ? null : positiveSeconds(options.bounded, "bounded");
  const maxWait = options["max-wait"] === undefined ? maxHours * 3600 : positiveSeconds(options["max-wait"], "max-wait");
  const sleep = ctx.sleep ?? realSleep;
  const reporter = createReporter(ctx);
  const streaks = new Map();
  const startedAt = ctx.now();

  for (;;) {
    let allReady = true;
    for (const ref of refs) {
      const label = refLabel(ref);
      try {
        const evaluation = await evaluatePr(ctx.gh, ref, project, ctx.now);
        streaks.set(label, 0);
        reporter.state(ref, evaluation);
        allReady = allReady && evaluation.ready;
      } catch (error) {
        if (error instanceof GhMissingError) throw error;
        const streak = (streaks.get(label) ?? 0) + 1;
        streaks.set(label, streak);
        reporter.error(ref, error.message);
        if (streak >= MAX_CONSECUTIVE_ERRORS) {
          ctx.stderr.write(`${label}: ${streak} consecutive gh errors, giving up: ${error.message}\n`);
          return 1;
        }
        allReady = false;
      }
    }
    if (allReady) return 0;
    const elapsed = Math.floor((ctx.now() - startedAt) / 1000);
    const deadline = nextDeadline(elapsed, bounded, maxWait);
    if (deadline) {
      ctx.stderr.write(`${deadline.message}\n`);
      return deadline.exit;
    }
    const remaining = Math.min(bounded ?? Infinity, maxWait) - elapsed;
    await sleep(Math.min(pollSeconds, remaining) * 1000);
  }
}
