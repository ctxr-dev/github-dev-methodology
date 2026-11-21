import { UsageError } from "./errors.mjs";

export function parseFlags(args, { values = [], booleans = [] } = {}) {
  const options = {};
  const positionals = [];
  const flagNames = [...booleans, "json"];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (flagNames.includes(name)) {
      options[name] = true;
      continue;
    }
    if (!values.includes(name)) throw new UsageError(`unknown option: --${name}`);
    if (equals !== -1) {
      options[name] = token.slice(equals + 1);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
    options[name] = value;
    index += 1;
  }
  return { options, positionals };
}
