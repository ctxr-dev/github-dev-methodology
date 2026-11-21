import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UsageError } from "./lib/errors.mjs";
import { createGh } from "./lib/gh.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const COMMAND_TOKEN = /^[a-z][a-z0-9-]*$/;
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 64;
const EXIT_SIGINT = 130;

function processStreams() {
  return {
    stdout: { write: (text) => process.stdout.write(text) },
    stderr: { write: (text) => process.stderr.write(text) },
  };
}

function buildContext(overrides) {
  return {
    cwd: process.cwd(),
    env: process.env,
    gh: createGh(),
    now: Date.now,
    commandsDir: join(SCRIPTS_DIR, "commands"),
    ...processStreams(),
    ...overrides,
  };
}

function extractGlobalFlags(argv) {
  const args = [];
  let cwd = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--cwd") {
      cwd = argv[index + 1];
      if (!cwd) throw new UsageError("--cwd needs a directory");
      index += 1;
    } else if (token.startsWith("--cwd=")) {
      cwd = token.slice("--cwd=".length);
    } else {
      args.push(token);
    }
  }
  return { args, cwd, json: args.includes("--json") };
}

export function listCommands(commandsDir) {
  if (!existsSync(commandsDir)) return [];
  return readdirSync(commandsDir)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => name.slice(0, -".mjs".length))
    .map((name) => name.replace("-", " "))
    .sort();
}

function usageText(commandsDir) {
  const commands = listCommands(commandsDir).map((name) => `  gdm ${name}`);
  const listing = commands.length > 0 ? commands.join("\n") : "  (no commands installed)";
  return [
    "usage: gdm [--json] [--cwd <dir>] <group> <command> [args]",
    "",
    "commands:",
    listing,
    "",
    "exit codes: 0 ok, 1 failure, 2 timeout, 3 not ready, 4 needs human, 64 usage, 130 interrupted",
    "",
  ].join("\n");
}

function resolveCommandFile(commandsDir, args) {
  const [group, command] = args;
  if (!COMMAND_TOKEN.test(group ?? "")) return null;
  if (COMMAND_TOKEN.test(command ?? "")) {
    const grouped = join(commandsDir, `${group}-${command}.mjs`);
    if (existsSync(grouped)) return { file: grouped, rest: args.slice(2) };
  }
  const single = join(commandsDir, `${group}.mjs`);
  return existsSync(single) ? { file: single, rest: args.slice(1) } : null;
}

async function runCommand(file, rest, ctx) {
  const module = await import(pathToFileURL(file).href);
  if (typeof module.run !== "function") throw new Error(`${file} does not export run(args, ctx)`);
  const code = await module.run(rest, ctx);
  if (!Number.isInteger(code)) throw new Error(`${file} did not return an integer exit code`);
  return code;
}

export async function main(argv, overrides = {}) {
  const ctx = buildContext(overrides);
  try {
    const flags = extractGlobalFlags(argv);
    if (flags.cwd) ctx.cwd = resolve(ctx.cwd, flags.cwd);
    ctx.json = flags.json;
    const { args } = flags;
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      ctx.stdout.write(usageText(ctx.commandsDir));
      return EXIT_OK;
    }
    const target = resolveCommandFile(ctx.commandsDir, args);
    if (!target) {
      ctx.stderr.write(`gdm: unknown command: ${args.slice(0, 2).join(" ")}\n${usageText(ctx.commandsDir)}`);
      return EXIT_USAGE;
    }
    return await runCommand(target.file, target.rest, ctx);
  } catch (error) {
    ctx.stderr.write(`gdm: ${error.message}\n`);
    return error instanceof UsageError ? error.exitCode : EXIT_FAILURE;
  }
}

function isExecutedDirectly() {
  return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isExecutedDirectly()) {
  process.on("SIGINT", () => process.exit(EXIT_SIGINT));
  process.exitCode = await main(process.argv.slice(2));
}
