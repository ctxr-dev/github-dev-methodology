import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { loadRepoConfig } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/config.mjs";

const assetText = (name) => readFileSync(new URL(`../plugins/github-dev-methodology/skills/github-dev-methodology/assets/${name}`, import.meta.url), "utf8");
const block = `<!-- gdm:start -->\n${assetText("agents-md-block.md").trim()}\n<!-- gdm:end -->`;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), "gdm-init-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "README.md"), "hello\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

async function gdm(argv, cwd) {
  const out = [];
  const err = [];
  const code = await main(argv, { cwd, stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } });
  return { code, out: out.join(""), err: err.join("") };
}

function snapshot(dir, base = dir) {
  return readdirSync(dir).filter((name) => name !== ".git").sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? snapshot(path, base) : [[path.slice(base.length), readFileSync(path, "utf8")]];
  });
}

function statSyncSafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const initArgs = ["init", "--preset", "pr-only", "--org", "acme", "--repo", "widgets"];

test("init in a repo without AGENTS.md creates config, gitignore and AGENTS.md", async () => {
  const root = scratchRepo();
  const result = await gdm(initArgs, root);
  assert.equal(result.code, 0, result.err);
  assert.equal(readFileSync(join(root, ".github-dev-methodology/.gitignore"), "utf8"), "config.local.json\n");
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), `# AGENTS.md\n\n## Methodologies\n\n${block}\n`);
  const loaded = loadRepoConfig(root);
  assert.equal(loaded.projectSlug, "widgets");
  assert.equal(loaded.project.preset, "pr-only");
  assert.equal(loaded.project.org, "acme");
  assert.equal(loaded.project.primary_repo, "widgets");
  assert.equal(loaded.config.active_project, "widgets");
  assert.equal(loaded.project.merge.authority, "human");
});

test("init twice is byte-identical and git status lists only the two expected paths", async () => {
  const root = scratchRepo();
  await gdm(initArgs, root);
  const first = snapshot(root);
  const second = await gdm(initArgs, root);
  assert.equal(second.code, 0);
  assert.match(second.out, /config exists/);
  assert.deepEqual(snapshot(root), first);
  const status = git(root, "status", "--porcelain").trim().split("\n").map((line) => line.slice(3)).sort();
  assert.deepEqual(status, [".github-dev-methodology/", "AGENTS.md"]);
});

test("--project overrides the default slug", async () => {
  const root = scratchRepo();
  await gdm([...initArgs, "--project", "tools"], root);
  assert.equal(loadRepoConfig(root).projectSlug, "tools");
});

test("an existing config is kept untouched", async () => {
  const root = scratchRepo();
  await gdm(initArgs, root);
  const before = readFileSync(join(root, ".github-dev-methodology/config.json"), "utf8");
  const result = await gdm(["init", "--preset", "full", "--org", "other", "--repo", "other"], root);
  assert.equal(result.code, 0);
  assert.equal(readFileSync(join(root, ".github-dev-methodology/config.json"), "utf8"), before);
});

test("an AGENTS.md with a Methodologies section gets the block inside it, before the next heading", async () => {
  const root = scratchRepo();
  writeFileSync(join(root, "AGENTS.md"), "# Repo\n\n## Methodologies\n\n- other: thing\n\n## Build\n\nrun make\n");
  await gdm(initArgs, root);
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.equal(text, `# Repo\n\n## Methodologies\n\n- other: thing\n\n${block}\n\n## Build\n\nrun make\n`);
  await gdm(initArgs, root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), text);
});

test("an AGENTS.md without the section gets the section appended", async () => {
  const root = scratchRepo();
  writeFileSync(join(root, "AGENTS.md"), "# Repo\n\nrules here");
  await gdm(initArgs, root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), `# Repo\n\nrules here\n\n## Methodologies\n\n${block}\n`);
});

test("a heading inside a code fence is not mistaken for the section", async () => {
  const root = scratchRepo();
  writeFileSync(join(root, "AGENTS.md"), "# Repo\n\n```md\n## Methodologies\n```\n");
  await gdm(initArgs, root);
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(text.endsWith(`\n## Methodologies\n\n${block}\n`));
  assert.equal(text.indexOf("<!-- gdm:start -->"), text.lastIndexOf("<!-- gdm:start -->"));
});

test("existing markers are replaced in place and surrounding bytes are preserved", async () => {
  const root = scratchRepo();
  const original = "# Repo\n\n## Methodologies\n\n<!-- gdm:start -->\nstale text\n<!-- gdm:end -->\n\n## Tail\n";
  writeFileSync(join(root, "AGENTS.md"), original);
  await gdm(initArgs, root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), `# Repo\n\n## Methodologies\n\n${block}\n\n## Tail\n`);
});

test("an unpaired marker fails without touching AGENTS.md", async () => {
  const root = scratchRepo();
  writeFileSync(join(root, "AGENTS.md"), "# Repo\n\n<!-- gdm:start -->\nno end\n");
  const result = await gdm(initArgs, root);
  assert.equal(result.code, 1);
  assert.match(result.err, /unpaired gdm marker/);
  assert.equal(statSyncSafe(join(root, ".github-dev-methodology")), false);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# Repo\n\n<!-- gdm:start -->\nno end\n");
});

test("missing flags and unknown presets exit 64", async () => {
  const root = scratchRepo();
  assert.equal((await gdm(["init", "--preset", "full"], root)).code, 64);
  assert.equal((await gdm(["init", "--preset", "huge", "--org", "a", "--repo", "b"], root)).code, 64);
  assert.equal((await gdm([...initArgs, "--project", "bad slug"], root)).code, 64);
});

test("init outside a git repository fails and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gdm-init-nogit-"));
  const result = await gdm(initArgs, dir);
  assert.equal(result.code, 1);
  assert.deepEqual(readdirSync(dir), []);
});
