import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, git, gdm, lastLine } from "./helpers/worktree-env.mjs";

const CREATED = Date.parse("2026-01-01T00:00:00.000Z");
const recordFile = (env, ...segments) => join(env.home, "state", "github.com", "acme", "app", "worktrees", ...segments);

async function addWorktree(env, branch, owner = "agent-1") {
  const result = await gdm(env, ["worktrees", "add", branch, "--owner", owner], { now: () => CREATED });
  assert.equal(result.code, 0, result.err);
  return lastLine(result.out);
}

async function releaseWorktree(env, target) {
  const result = await gdm(env, ["worktrees", "release", target]);
  assert.equal(result.code, 0, result.err);
}

const lockLine = (env, path) => git(env.checkout, "worktree", "list", "--porcelain").split("\n\n").find((block) => block.startsWith(`worktree ${path}\n`));

test("add records the owner and takes a gdm lock", async () => {
  const env = fixture();
  const path = await addWorktree(env, "fix/1-x", "agent-1");
  const record = JSON.parse(readFileSync(recordFile(env, "fix", "1-x.json"), "utf8"));
  assert.deepEqual(record, { branch: "fix/1-x", path, owner: "agent-1", created_at: "2026-01-01T00:00:00.000Z" });
  assert.match(lockLine(env, path), /\nlocked gdm: owner=agent-1 created=2026-01-01T00:00:00\.000Z/);
});

test("add defaults the owner to <hostname>:<ppid>", async () => {
  const env = fixture();
  await gdm(env, ["worktrees", "add", "fix/1-x"]);
  const record = JSON.parse(readFileSync(recordFile(env, "fix", "1-x.json"), "utf8"));
  assert.match(record.owner, /:\d+$/);
});

test("add warns and still succeeds when the lock cannot be taken", async () => {
  const env = fixture();
  const wrapGit = (args, cwd, real) => (args[0] === "worktree" && args[1] === "lock" ? { status: 1, stdout: "", stderr: "boom\n" } : real(args, cwd));
  const result = await gdm(env, ["worktrees", "add", "fix/1-x", "--owner", "a"], { wrapGit });
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /^warn: could not lock .*fix\/1-x: boom/m);
  assert.ok(existsSync(lastLine(result.out)));
  assert.ok(existsSync(recordFile(env, "fix", "1-x.json")));
});

test("prune <branch> keeps a locked worktree; after release it removes it, its record and empty parents", async () => {
  const env = fixture();
  const path = await addWorktree(env, "fix/1-x");
  const ghStates = { "fix/1-x": "MERGED" };

  const held = await gdm(env, ["worktrees", "prune", "fix/1-x", "--json"], { ghStates });
  assert.equal(held.code, 0, held.err);
  const heldReport = JSON.parse(held.out);
  assert.deepEqual(heldReport.removed, []);
  assert.equal(heldReport.kept[0].reason, "locked (gdm: owner=agent-1 created=2026-01-01T00:00:00.000Z); run gdm worktrees release first");
  assert.ok(existsSync(path));

  await releaseWorktree(env, "fix/1-x");
  const done = await gdm(env, ["worktrees", "prune", "fix/1-x", "--json"], { ghStates });
  assert.equal(done.code, 0, done.err);
  assert.deepEqual(JSON.parse(done.out).removed.map((item) => item.branch), ["fix/1-x"]);
  assert.ok(!existsSync(path));
  assert.ok(!existsSync(recordFile(env, "fix", "1-x.json")));
  assert.ok(!existsSync(join(env.home, "state", "github.com")));
  assert.ok(existsSync(join(env.home, "state")));
  assert.ok(!existsSync(join(env.home, "worktrees", "github.com")));
  assert.ok(existsSync(join(env.home, "worktrees")));
  assert.equal(git(env.checkout, "branch", "--list", "fix/1-x"), "");
});

test("prune keeps parent directories that still hold other worktrees", async () => {
  const env = fixture();
  await addWorktree(env, "fix/1-x");
  const sibling = await addWorktree(env, "fix/2-y");
  await releaseWorktree(env, "fix/1-x");
  const result = await gdm(env, ["worktrees", "prune", "fix/1-x"], { ghStates: { "fix/1-x": "MERGED" } });
  assert.equal(result.code, 0, result.err);
  assert.ok(existsSync(sibling));
  assert.ok(existsSync(join(env.worktrees, "fix")));
  assert.ok(existsSync(recordFile(env, "fix", "2-y.json")));
});

test("prune accepts a path and reports unknown targets, the main worktree and client-managed worktrees", async () => {
  const env = fixture();
  const path = await addWorktree(env, "fix/1-x");
  await releaseWorktree(env, path);
  const clientPath = join(env.checkout, ".claude", "worktrees", "x");
  git(env.checkout, "worktree", "add", "-q", clientPath, "-b", "claude/x", "origin/main");
  const ghStates = { "fix/1-x": "MERGED", "claude/x": "MERGED", main: "MERGED" };

  const result = await gdm(env, ["worktrees", "prune", path, "nope", env.checkout, clientPath, "--json"], { ghStates });
  assert.equal(result.code, 0, result.err);
  const report = JSON.parse(result.out);
  assert.deepEqual(report.removed.map((item) => item.branch), ["fix/1-x"]);
  assert.deepEqual(report.kept.map((item) => item.reason), ["no worktree for nope", "main worktree", "client-managed worktree"]);
  assert.ok(existsSync(clientPath));
  assert.ok(existsSync(env.checkout));
});

test("prune without a target or flag, or with both, is a usage error", async () => {
  const env = fixture();
  const none = await gdm(env, ["worktrees", "prune"]);
  assert.equal(none.code, 64);
  assert.match(none.err, /usage: gdm worktrees prune <path\|branch>\.\.\. \| --all-merged/);
  const both = await gdm(env, ["worktrees", "prune", "fix/1-x", "--all-merged"]);
  assert.equal(both.code, 64);
});

test("--all-merged removes only released, gdm-owned, merged, clean worktrees inside the root", async () => {
  const env = fixture();
  const released = await addWorktree(env, "fix/1-released");
  await releaseWorktree(env, "fix/1-released");
  const leased = await addWorktree(env, "fix/2-leased");
  const dirty = await addWorktree(env, "fix/3-dirty");
  await releaseWorktree(env, "fix/3-dirty");
  writeFileSync(join(dirty, "wip.txt"), "x");
  const open = await addWorktree(env, "fix/4-open");
  await releaseWorktree(env, "fix/4-open");
  const plain = join(env.worktrees, "fix", "5-plain");
  git(env.checkout, "worktree", "add", "-q", plain, "-b", "fix/5-plain", "origin/main");
  const outside = join(env.base, "outside");
  git(env.checkout, "worktree", "add", "-q", outside, "-b", "fix/6-outside", "origin/main");
  const clientPath = join(env.checkout, ".claude", "worktrees", "x");
  git(env.checkout, "worktree", "add", "-q", clientPath, "-b", "claude/x", "origin/main");
  const ghStates = Object.fromEntries(["fix/1-released", "fix/2-leased", "fix/3-dirty", "fix/5-plain", "fix/6-outside", "claude/x"].map((b) => [b, "MERGED"]));
  ghStates["fix/4-open"] = "OPEN";

  const result = await gdm(env, ["worktrees", "prune", "--all-merged", "--json"], { ghStates });
  assert.equal(result.code, 0, result.err);
  const report = JSON.parse(result.out);
  assert.deepEqual(report.removed.map((item) => item.branch), ["fix/1-released"]);
  assert.deepEqual(Object.fromEntries(report.kept.map((item) => [item.branch, item.reason])), { "fix/3-dirty": "dirty", "fix/4-open": "PR open" });
  const skipped = Object.fromEntries(report.skipped.map((item) => [item.branch, item.reason]));
  assert.match(skipped["fix/2-leased"], /^locked \(gdm: owner=agent-1 /);
  assert.equal(skipped["fix/5-plain"], "not created by gdm");
  assert.equal(skipped["fix/6-outside"], "outside worktrees_root");
  assert.equal(skipped["claude/x"], "outside worktrees_root");
  [leased, dirty, open, plain, outside, clientPath].forEach((path) => assert.ok(existsSync(path), path));
  assert.ok(!existsSync(released));
  assert.ok(!result.calls.some((args) => args.includes("fix/2-leased")));
});

test("--all-merged text mode stays silent about skipped worktrees", async () => {
  const env = fixture();
  await addWorktree(env, "fix/1-x");
  const result = await gdm(env, ["worktrees", "prune", "--all-merged"], { ghStates: { "fix/1-x": "MERGED" } });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "");
});

test("release unlocks a gdm lock, defaults to the current worktree and is idempotent", async () => {
  const env = fixture();
  const path = await addWorktree(env, "fix/1-x");
  const first = await gdm(env, ["worktrees", "release"], { cwd: path });
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out.trim(), `released: ${path}`);
  assert.doesNotMatch(lockLine(env, path), /locked/);
  const second = await gdm(env, ["worktrees", "release", "fix/1-x"]);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.out.trim(), `not locked: ${path}`);
  assert.ok(existsSync(recordFile(env, "fix", "1-x.json")));
});

test("release never unlocks a lock held by another tool and rejects unknown targets", async () => {
  const env = fixture();
  const path = join(env.worktrees, "other");
  git(env.checkout, "worktree", "add", "-q", path, "-b", "other", "origin/main");
  git(env.checkout, "worktree", "lock", "--reason", "portable drive", path);
  const refused = await gdm(env, ["worktrees", "release", "other"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /locked by another tool: portable drive/);
  assert.match(lockLine(env, path), /locked portable drive/);
  const unknown = await gdm(env, ["worktrees", "release", "missing"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /no worktree for missing/);
  const outside = await gdm(env, ["worktrees", "release"], { cwd: env.base });
  assert.equal(outside.code, 1);
});

test("census reports owner, lock reason, lock age and the gdm-owned flag", async () => {
  const env = fixture();
  await addWorktree(env, "fix/1-x", "agent-1");
  const plain = join(env.worktrees, "plain");
  git(env.checkout, "worktree", "add", "-q", plain, "-b", "plain", "origin/main");
  const now = () => CREATED + 90_000;
  const json = await gdm(env, ["worktrees", "census", "--json"], { now });
  assert.equal(json.code, 0, json.err);
  const byBranch = Object.fromEntries(JSON.parse(json.out).worktrees.map((item) => [item.branch, item]));
  assert.equal(byBranch["fix/1-x"].owner, "agent-1");
  assert.equal(byBranch["fix/1-x"].lock, "gdm: owner=agent-1 created=2026-01-01T00:00:00.000Z");
  assert.equal(byBranch["fix/1-x"].lock_age_seconds, 90);
  assert.deepEqual(byBranch["fix/1-x"].flags, ["locked", "gdm-owned"]);
  assert.deepEqual(byBranch.plain, { ...byBranch.plain, owner: null, lock: null, lock_age_seconds: null, flags: [] });
  assert.equal(byBranch.main.owner, null);
  const text = await gdm(env, ["worktrees", "census"], { now });
  assert.match(text.out, /fix\/1-x .*\[locked,gdm-owned\] {2}lock: owner=agent-1 age=1m/);
});
