export const MERGE_PATTERNS = [
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+stack\s+merge\b/,
  /\bgh\s+api\b.*\/pulls\/\d+\/merge\b/,
];

const VALUE_FLAGS = new Set([
  "-R",
  "--repo",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--subject",
  "-A",
  "--author-email",
  "--match-head-commit",
]);
const API_MERGE_PATH = /\/?repos\/([^/\s"']+)\/([^/\s"']+)\/pulls\/(\d+)\/merge\b/;

function tokenize(text) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char) || char === ";" || char === "&" || char === "|") {
      if (current !== "") tokens.push(current);
      current = "";
      if (!/\s/.test(char)) return tokens;
    } else {
      current += char;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function tokensAfter(command, pattern) {
  const match = pattern.exec(command);
  return match ? tokenize(command.slice(match.index + match[0].length)) : [];
}

function readArguments(tokens) {
  let repo = null;
  let positional = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const [flag, inline] = token.startsWith("--") ? token.split(/=(.*)/s) : [token, undefined];
    if (token.startsWith("-")) {
      const takesValue = VALUE_FLAGS.has(flag);
      const value = inline ?? (takesValue ? tokens[index + 1] ?? "" : null);
      if (takesValue && inline === undefined) index += 1;
      if (flag === "-R" || flag === "--repo") repo = value;
    } else if (positional === null) {
      positional = token;
    }
  }
  return { repo, positional };
}

function prArgFromCli(command, pattern) {
  const { repo, positional } = readArguments(tokensAfter(command, pattern));
  if (positional === null) return null;
  return repo && /^\d+$/.test(positional) ? `${repo}#${positional}` : positional;
}

function prArgFromApi(command) {
  const match = API_MERGE_PATH.exec(command);
  return match ? `${match[1]}/${match[2]}#${match[3]}` : null;
}

export function matchMerge(command) {
  const text = typeof command === "string" ? command : "";
  const [cliMerge, stackMerge, apiMerge] = MERGE_PATTERNS;
  if (cliMerge.test(text)) return { matched: true, prArg: prArgFromCli(text, cliMerge) };
  if (stackMerge.test(text)) return { matched: true, prArg: prArgFromCli(text, stackMerge) };
  if (apiMerge.test(text)) return { matched: true, prArg: prArgFromApi(text) };
  return { matched: false, prArg: null };
}
