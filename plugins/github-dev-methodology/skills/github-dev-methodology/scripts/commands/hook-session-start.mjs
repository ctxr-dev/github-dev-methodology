import { ConfigMissingError } from "../lib/errors.mjs";
import { loadRepoConfig } from "../lib/config.mjs";
import { hookCwd, parseClient, parseHookPayload, readStdinText } from "../lib/hook-io.mjs";
import { renderSessionContext, SKILL_DIR, sessionStartOutput } from "../lib/session-context.mjs";

export async function run(args, ctx) {
  parseClient(args);
  try {
    const payload = parseHookPayload(await readStdinText(ctx));
    const loaded = loadRepoConfig(hookCwd(payload, ctx), { git: ctx.git });
    const context = renderSessionContext(ctx.skillDir ?? SKILL_DIR, loaded.features, loaded.path);
    ctx.stdout.write(sessionStartOutput(context));
  } catch (error) {
    if (!(error instanceof ConfigMissingError)) ctx.stderr.write(`gdm hook session-start: ${error.message}\n`);
  }
  return 0;
}
