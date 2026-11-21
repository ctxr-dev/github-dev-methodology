import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/+$/, "");

function enabledFlagNames(flags) {
  if (Array.isArray(flags)) return flags;
  return Object.entries(flags ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);
}

export function renderSessionContext(skillDir, flags, configPath) {
  const template = readFileSync(join(skillDir, "assets", "session-context.md"), "utf8").trimEnd();
  const names = enabledFlagNames(flags);
  const values = {
    "{{SKILL_DIR}}": skillDir,
    "{{ACTIVE_FEATURES}}": names.length > 0 ? names.join(", ") : "none",
    "{{CONFIG_PATH}}": configPath,
  };
  return Object.entries(values).reduce((text, [token, value]) => text.replaceAll(token, value), template);
}

export function sessionStartOutput(context) {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } })}\n`;
}
