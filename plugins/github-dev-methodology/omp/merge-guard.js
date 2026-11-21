import { createGh } from "../skills/github-dev-methodology/scripts/lib/gh.mjs";
import { checkMerge } from "../skills/github-dev-methodology/scripts/lib/merge-guard.mjs";

const CONFIRM_TITLE = "Merge requires owner approval";

async function askOwner(ctx, reason) {
  if (!ctx.hasUI) return { block: true, reason };
  const approved = await ctx.ui.confirm(CONFIRM_TITLE, reason);
  return approved ? undefined : { block: true, reason: "owner declined merge" };
}

export function createMergeGuardHandler(deps = {}) {
  const gh = deps.gh ?? createGh();
  return async function onToolCall(event, ctx) {
    const command = event.input?.command;
    if (event.toolName !== "bash" || typeof command !== "string") return undefined;
    try {
      const verdict = await checkMerge({ ...deps, command, cwd: ctx?.cwd ?? process.cwd(), gh });
      if (!verdict || verdict.decision === "allow") return undefined;
      if (verdict.decision === "ask") return await askOwner(ctx, verdict.reason);
      return { block: true, reason: verdict.reason };
    } catch (error) {
      return { block: true, reason: error.message };
    }
  };
}

export default function mergeGuard(pi) {
  pi.on("tool_call", createMergeGuardHandler());
}
