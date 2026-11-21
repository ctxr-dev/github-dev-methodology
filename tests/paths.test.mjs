import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigInvalidError, UsageError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { gdmHome, loadUserConfig, repoConfigDir, statePath, userConfigPath, worktreePath } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/paths.mjs";

const id = { host: "github.com", owner: "ctxr-dev", repo: "gdm" };
const freshHome = () => mkdtempSync(join(tmpdir(), "gdm-paths-"));

test("gdmHome honours GDM_HOME and falls back to HOME", () => {
  assert.equal(gdmHome({ GDM_HOME: "/data/gdm" }), "/data/gdm");
  assert.equal(gdmHome({ HOME: "/home/u" }), "/home/u/.github-dev-methodology");
  assert.equal(userConfigPath({ GDM_HOME: "/data/gdm" }), "/data/gdm/config.json");
});

test("worktreePath nests branch segments under host/owner/repo", () => {
  const env = { GDM_HOME: freshHome() };
  assert.equal(worktreePath(id, "fix/123-null", env), join(env.GDM_HOME, "worktrees/github.com/ctxr-dev/gdm/fix/123-null"));
  assert.equal(worktreePath(id, "main", env), join(env.GDM_HOME, "worktrees/github.com/ctxr-dev/gdm/main"));
});

test("worktreePath rejects traversal and absolute branch names", () => {
  const env = { GDM_HOME: freshHome() };
  assert.throws(() => worktreePath(id, "../escape", env), UsageError);
  assert.throws(() => worktreePath(id, "a/../b", env), UsageError);
  assert.throws(() => worktreePath(id, "/abs", env), UsageError);
  assert.throws(() => worktreePath(id, "", env), UsageError);
  assert.throws(() => worktreePath({ ...id, owner: ".." }, "ok", env), UsageError);
});

test("user config worktrees_root overrides the default and expands ~", () => {
  const home = freshHome();
  const env = { GDM_HOME: home, HOME: "/home/u" };
  assert.equal(loadUserConfig(env).worktrees_root, join(home, "worktrees"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ schema_version: 1, worktrees_root: "~/wt" }));
  assert.equal(loadUserConfig(env).worktrees_root, "/home/u/wt");
  assert.equal(worktreePath(id, "b", env), "/home/u/wt/github.com/ctxr-dev/gdm/b");
});

test("invalid user config throws ConfigInvalidError", () => {
  const home = freshHome();
  writeFileSync(join(home, "config.json"), JSON.stringify({ schema_version: 1, extra: true }));
  assert.throws(() => loadUserConfig({ GDM_HOME: home }), ConfigInvalidError);
  writeFileSync(join(home, "config.json"), "{ nope");
  assert.throws(() => loadUserConfig({ GDM_HOME: home }), ConfigInvalidError);
});

test("statePath and repoConfigDir follow the data layout", () => {
  assert.equal(
    statePath(id, { GDM_HOME: "/h" }, "plans", "p1.ledger.json"),
    "/h/state/github.com/ctxr-dev/gdm/plans/p1.ledger.json",
  );
  assert.throws(() => statePath(id, { GDM_HOME: "/h" }, "..", "x"), UsageError);
  assert.equal(repoConfigDir("/repo"), "/repo/.github-dev-methodology");
});
