import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { createGh } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";
import { spawnGit } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/repo-identity.mjs";

const ORIGIN_URL = "https://github.com/acme/app.git";
const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

function git(cwd, ...args) {
  return execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gdm-wt-")));
  const source = join(base, "src");
  mkdirSync(source);
  git(source, "init", "-q", "-b", "main");
  git(source, "commit", "-q", "--allow-empty", "-m", "initial");
  git(base, "clone", "-q", "--bare", source, "origin.git");
  git(base, "clone", "-q", join(base, "origin.git"), "checkout");
  const checkout = join(base, "checkout");
  git(checkout, "remote", "set-head", "origin", "-a");
  const home = join(base, "home");
  return { base, checkout, home, worktrees: join(home, "worktrees", "github.com", "acme", "app") };
}

function gitWithGithubOrigin(args, cwd) {
  if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
    return { status: 0, stdout: `${ORIGIN_URL}\n`, stderr: "" };
  }
  return spawnGit(args, cwd);
}

function fakeGh(stateByBranch = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    const branch = args[args.indexOf("--head") + 1];
    const state = stateByBranch[branch];
    return { status: 0, stdout: JSON.stringify(state ? [{ state }] : []), stderr: "" };
  };
  return { gh: createGh(runner), calls };
}

async function gdm(env, argv, { ghStates = {}, cwd } = {}) {
  const out = [];
  const err = [];
  const { gh, calls } = fakeGh(ghStates);
  const code = await main(argv, {
    cwd: cwd ?? env.checkout,
    env: { ...process.env, GDM_HOME: env.home },
    git: gitWithGithubOrigin,
    gh,
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(""), err: err.join(""), calls };
}

const lastLine = (text) => text.trim().split("\n").at(-1);

test("add creates the worktree at <home>/worktrees/<host>/<owner>/<repo>/<branch> from origin's default branch", async () => {
  const env = fixture();
  const result = await gdm(env, ["worktrees", "add", "fix/1-x"]);
  const expected = join(env.worktrees, "fix", "1-x");
  assert.equal(result.code, 0, result.err);
  assert.equal(lastLine(result.out), expected);
  assert.ok(existsSync(join(expected, ".git")));
  assert.equal(git(expected, "rev-parse", "--abbrev-ref", "HEAD"), "fix/1-x");
  assert.equal(git(expected, "rev-parse", "HEAD"), git(env.checkout, "rev-parse", "origin/main"));
});

test("add picks up commits that exist on origin only after a fetch", async () => {
  const env = fixture();
  git(join(env.base, "src"), "commit", "-q", "--allow-empty", "-m", "second");
  git(join(env.base, "origin.git"), "fetch", "-q", join(env.base, "src"), "main:main");
  const result = await gdm(env, ["worktrees", "add", "feat/2-new"]);
  assert.equal(result.code, 0, result.err);
  const path = lastLine(result.out);
  assert.equal(git(path, "log", "-1", "--format=%s"), "second");
});

test("add honours --base and reuses an existing branch without -b", async () => {
  const env = fixture();
  git(env.checkout, "branch", "chore/old", "origin/main");
  const reused = await gdm(env, ["worktrees", "add", "chore/old"]);
  assert.equal(reused.code, 0, reused.err);
  assert.equal(git(lastLine(reused.out), "rev-parse", "--abbrev-ref", "HEAD"), "chore/old");
  const based = await gdm(env, ["worktrees", "add", "chore/new", "--base", "origin/main"]);
  assert.equal(based.code, 0, based.err);
  git(env.checkout, "branch", "chore/other", "origin/main");
  const conflict = await gdm(env, ["worktrees", "add", "chore/other", "--base=origin/main"]);
  assert.equal(conflict.code, 64);
  assert.match(conflict.err, /already exists/);
});

test("add exits 1 with 'worktree path exists' when the path is taken", async () => {
  const env = fixture();
  const first = await gdm(env, ["worktrees", "add", "fix/1-x"]);
  const second = await gdm(env, ["worktrees", "add", "fix/1-x"]);
  assert.equal(second.code, 1);
  assert.equal(second.err.trim(), `gdm: worktree path exists: ${lastLine(first.out)}`);
});

test("add exits 1 for an unknown base ref and 64 without a branch", async () => {
  const env = fixture();
  const missing = await gdm(env, ["worktrees", "add", "fix/3-y", "--base", "origin/nope"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /base ref not found: origin\/nope/);
  const usage = await gdm(env, ["worktrees", "add"]);
  assert.equal(usage.code, 64);
});

test("census lists main, dirty and legacy-location worktrees and orphan directories", async () => {
  const env = fixture();
  const added = await gdm(env, ["worktrees", "add", "fix/1-x"]);
  const dirtyPath = lastLine(added.out);
  writeFileSync(join(dirtyPath, "scratch.txt"), "x");
  const legacy = join(env.base, "legacy-sibling");
  git(env.checkout, "worktree", "add", "-q", legacy, "-b", "old/branch", "origin/main");
  const orphan = join(env.worktrees, "stray", "dir");
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, "file.txt"), "x");

  const result = await gdm(env, ["worktrees", "census", "--json"], { ghStates: { "fix/1-x": "OPEN" } });
  assert.equal(result.code, 0, result.err);
  const report = JSON.parse(result.out);
  const byBranch = Object.fromEntries(report.worktrees.map((item) => [item.branch, item]));
  assert.equal(byBranch.main.main, true);
  assert.equal(byBranch.main.pr, null);
  assert.deepEqual(byBranch["fix/1-x"].flags, ["dirty"]);
  assert.equal(byBranch["fix/1-x"].pr, "OPEN");
  assert.equal(byBranch["fix/1-x"].dirty, true);
  assert.equal(typeof byBranch["fix/1-x"].lastCommitAgeSeconds, "number");
  assert.deepEqual(byBranch["old/branch"].flags, ["legacy-location"]);
  assert.equal(byBranch["old/branch"].pr, "NONE");
  assert.deepEqual(report.orphans, [{ path: orphan, flags: ["orphan-dir"] }]);
  const listed = result.calls.find((args) => args.includes("fix/1-x"));
  assert.deepEqual(listed.slice(0, 2), ["pr", "list"]);
  assert.ok(listed.includes("--state") && listed.includes("all") && listed.includes("--json"));
  assert.ok(existsSync(orphan));
});

test("census text output names flags and PR state", async () => {
  const env = fixture();
  await gdm(env, ["worktrees", "add", "fix/1-x"]);
  const result = await gdm(env, ["worktrees", "census"], { ghStates: { "fix/1-x": "MERGED" } });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /fix\/1-x {2}PR:MERGED/);
  assert.match(result.out, /main {2}-/);
});

test("prune removes clean merged worktrees and their branch, keeps dirty, open and unmerged ones", async () => {
  const env = fixture();
  const paths = {};
  for (const branch of ["fix/1-merged", "fix/2-dirty", "fix/3-open", "fix/4-none"]) {
    paths[branch] = lastLine((await gdm(env, ["worktrees", "add", branch])).out);
  }
  writeFileSync(join(paths["fix/2-dirty"], "wip.txt"), "x");
  const ghStates = { "fix/1-merged": "MERGED", "fix/2-dirty": "MERGED", "fix/3-open": "OPEN" };

  const result = await gdm(env, ["worktrees", "prune", "--json"], { ghStates });
  assert.equal(result.code, 0, result.err);
  const report = JSON.parse(result.out);
  assert.deepEqual(report.removed.map((item) => item.branch), ["fix/1-merged"]);
  assert.equal(report.removed[0].branchKept, null);
  const reasons = Object.fromEntries(report.kept.map((item) => [item.branch, item.reason]));
  assert.deepEqual(reasons, { "fix/2-dirty": "dirty", "fix/3-open": "PR open", "fix/4-none": "no PR" });
  assert.ok(!existsSync(paths["fix/1-merged"]));
  assert.ok(existsSync(paths["fix/2-dirty"]));
  assert.equal(git(env.checkout, "branch", "--list", "fix/1-merged"), "");
  assert.notEqual(git(env.checkout, "branch", "--list", "fix/2-dirty"), "");
  assert.ok(existsSync(env.checkout));
});

test("prune never force-deletes: an unmerged branch survives and is reported", async () => {
  const env = fixture();
  const path = lastLine((await gdm(env, ["worktrees", "add", "fix/5-ahead"])).out);
  git(path, "commit", "-q", "--allow-empty", "-m", "unmerged work");
  const result = await gdm(env, ["worktrees", "prune"], { ghStates: { "fix/5-ahead": "MERGED" } });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /removed: .*fix\/5-ahead.*\(branch kept: .*not fully merged/);
  assert.ok(!existsSync(path));
  assert.notEqual(git(env.checkout, "branch", "--list", "fix/5-ahead"), "");
});

test("prune keeps the worktree the command runs from and never touches the main worktree", async () => {
  const env = fixture();
  const path = lastLine((await gdm(env, ["worktrees", "add", "fix/6-here"])).out);
  const result = await gdm(env, ["worktrees", "prune"], { ghStates: { "fix/6-here": "MERGED", main: "MERGED" }, cwd: path });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /kept: .*fix\/6-here.*current directory is inside/);
  assert.ok(existsSync(path));
  assert.ok(existsSync(env.checkout));
});
