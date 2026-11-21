import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GdmError, NotGitRepoError, UsageError } from "../lib/errors.mjs";
import { migrateLegacyConfig } from "../lib/legacy-migrate.mjs";
import { repoConfigDir } from "../lib/paths.mjs";
import { repoRoot } from "../lib/repo-identity.mjs";
import { parseFlags } from "../lib/setup-args.mjs";

function readLegacyFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new GdmError(`cannot read ${path}: ${error.message}`);
  }
}

function targetRoot(cwd) {
  try {
    return repoRoot(cwd);
  } catch (error) {
    if (error instanceof NotGitRepoError) return resolve(cwd);
    throw error;
  }
}

function writeConfig(cwd, content, ctx) {
  const dir = repoConfigDir(targetRoot(cwd));
  const path = join(dir, "config.json");
  if (existsSync(path)) {
    ctx.stderr.write(`config exists: ${path}\n`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
  ctx.stdout.write(`wrote ${path}\n`);
  return 0;
}

export async function run(args, ctx) {
  const { options, positionals } = parseFlags(args, { booleans: ["write"] });
  if (positionals.length !== 1) throw new UsageError("usage: gdm config migrate <old.config.local.md> [--write]");
  const { config, notMigrated, errors } = migrateLegacyConfig(readLegacyFile(resolve(ctx.cwd, positionals[0])));
  notMigrated.forEach((item) => ctx.stderr.write(`not migrated: ${item}\n`));
  if (errors.length > 0) {
    errors.forEach((error) => ctx.stderr.write(`error: ${error}\n`));
    return 1;
  }
  const content = `${JSON.stringify(config, null, 2)}\n`;
  if (!options.write) {
    ctx.stdout.write(content);
    return 0;
  }
  return writeConfig(ctx.cwd, content, ctx);
}
