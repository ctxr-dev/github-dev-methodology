import { loadRepoConfig } from "../lib/config.mjs";
import { UsageError } from "../lib/errors.mjs";
import { FLAGS, activeDocs } from "../lib/features.mjs";
import { parseFlags } from "../lib/setup-args.mjs";

export async function run(args, ctx) {
  const { options, positionals } = parseFlags(args, { values: ["project"] });
  if (positionals.length > 0) throw new UsageError("usage: gdm config features [--project <slug>] [--json]");
  const loaded = loadRepoConfig(ctx.cwd, { project: options.project });
  const docs = activeDocs(loaded.features);
  if (ctx.json) {
    const report = { project: loaded.projectSlug, preset: loaded.project.preset, flags: loaded.features, docs };
    ctx.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  }
  const lines = [
    `project: ${loaded.projectSlug} (preset ${loaded.project.preset})`,
    ...FLAGS.map((flag) => `${flag}: ${loaded.features[flag] ? "on" : "off"}`),
    "references:",
    ...docs.map((doc) => `  references/${doc}`),
  ];
  ctx.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
