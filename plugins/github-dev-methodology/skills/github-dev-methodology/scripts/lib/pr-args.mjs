import { UsageError } from "./errors.mjs";
import { loadRepoConfig } from "./config.mjs";
import { parsePrRef } from "./pr-state.mjs";

export function parseArgs(args, { values = [], variadic = [], flags = [] } = {}) {
  const positionals = [];
  const options = {};
  const seenFlags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    if (flags.includes(name)) {
      seenFlags.add(name);
    } else if (values.includes(name)) {
      const value = inline ?? args[(index += 1)];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      options[name] = value;
    } else if (variadic.includes(name)) {
      const collected = options[name] ?? [];
      if (inline !== undefined) collected.push(inline);
      while (index + 1 < args.length && !args[index + 1].startsWith("--")) collected.push(args[(index += 1)]);
      if (collected.length === 0) throw new UsageError(`--${name} needs at least one value`);
      options[name] = collected;
    } else {
      throw new UsageError(`unknown option: --${name}`);
    }
  }
  return { positionals, options, flags: seenFlags };
}

export function positiveSeconds(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`--${name} must be a positive integer (got ${value})`);
  return number;
}

export function loadPrContext(ctx, projectSlug) {
  const loaded = loadRepoConfig(ctx.cwd, { project: projectSlug });
  const defaults = { owner: loaded.project.org, repo: loaded.project.primary_repo };
  return { loaded, project: loaded.project, defaults };
}

export function requirePrRefs(positionals, defaults, { min = 1, max = Infinity } = {}) {
  if (positionals.length < min) throw new UsageError("a PR reference is required (owner/repo#N, a PR URL, or a number)");
  if (positionals.length > max) throw new UsageError(`expected at most ${max} PR reference(s)`);
  return positionals.map((text) => parsePrRef(text, defaults));
}
