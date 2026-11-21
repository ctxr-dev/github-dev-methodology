import { UsageError } from "./errors.mjs";

export function parseValidateArgs(args, { values = [], booleans = [] } = {}) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = splitFlag(token);
    if (name === "json") continue;
    if (booleans.includes(name)) {
      flags[name] = true;
    } else if (values.includes(name)) {
      const value = inline ?? args[index + 1];
      if (value === undefined || (inline === undefined && value.startsWith("--"))) {
        throw new UsageError(`--${name} needs a value`);
      }
      flags[name] = value;
      if (inline === undefined) index += 1;
    } else {
      throw new UsageError(`unknown flag --${name}`);
    }
  }
  return { positionals, flags };
}

function splitFlag(token) {
  const body = token.slice(2);
  const equals = body.indexOf("=");
  return equals === -1 ? [body, undefined] : [body.slice(0, equals), body.slice(equals + 1)];
}
