import { UsageError } from "./errors.mjs";

export const CLIENTS = ["claude", "codex"];
export const CODEX_ASK_SUFFIX = " Codex hooks cannot prompt: the owner merges this PR or grants scope in config.";

export function parseClient(args) {
  const index = args.findIndex((arg) => arg === "--client" || arg.startsWith("--client="));
  if (index === -1) throw new UsageError(`--client ${CLIENTS.join("|")} is required`);
  const token = args[index];
  const value = token.includes("=") ? token.slice("--client=".length) : args[index + 1];
  if (!CLIENTS.includes(value)) throw new UsageError(`--client must be one of: ${CLIENTS.join(", ")}`);
  return value;
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export async function readStdinText(ctx) {
  if (typeof ctx.stdin === "string") return ctx.stdin;
  const stream = ctx.stdin ?? process.stdin;
  if (stream.isTTY) return "";
  return collect(stream);
}

export function parseHookPayload(text) {
  if (text.trim() === "") return {};
  const payload = JSON.parse(text);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("hook input must be a JSON object");
  }
  return payload;
}

export function hookCwd(payload, ctx) {
  return typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : ctx.cwd;
}

export function preToolUseOutput(permissionDecision, reason) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason: reason,
    },
  })}\n`;
}

export function verdictOutput(client, { decision, reason }) {
  if (decision === "allow") return "";
  if (decision === "ask" && client === "codex") return preToolUseOutput("deny", `${reason}${CODEX_ASK_SUFFIX}`);
  return preToolUseOutput(decision, reason);
}

export function failureOutput(client, error) {
  return preToolUseOutput(client === "claude" ? "ask" : "deny", `github-dev-methodology merge guard failed: ${error.message}`);
}
