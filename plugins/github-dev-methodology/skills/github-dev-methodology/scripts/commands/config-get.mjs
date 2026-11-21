import { loadRepoConfig } from "../lib/config.mjs";
import { UsageError } from "../lib/errors.mjs";
import { parseFlags } from "../lib/setup-args.mjs";

function lookup(root, dottedKey) {
  let node = root;
  for (const segment of dottedKey.split(".")) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) return { found: false };
    node = node[segment];
  }
  return { found: true, value: node };
}

function resolveValue(loaded, key) {
  if (key === "features" || key.startsWith("features.")) {
    return lookup({ features: loaded.features }, key);
  }
  const inProject = lookup(loaded.project, key);
  return inProject.found ? inProject : lookup(loaded.config, key);
}

export async function run(args, ctx) {
  const { options, positionals } = parseFlags(args, { values: ["project"] });
  if (positionals.length !== 1) throw new UsageError("usage: gdm config get <dotted.key> [--project <slug>]");
  const [key] = positionals;
  const loaded = loadRepoConfig(ctx.cwd, { project: options.project });
  const result = resolveValue(loaded, key);
  if (!result.found) {
    ctx.stderr.write(`config key not found: ${key}\n`);
    return 1;
  }
  ctx.stdout.write(`${typeof result.value === "string" ? result.value : JSON.stringify(result.value)}\n`);
  return 0;
}
