import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRepoConfig } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/config.mjs";
import { ConfigInvalidError, ConfigMissingError, ProjectMissingError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";

const template = JSON.parse(readFileSync(new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/assets/config.template.json", import.meta.url), "utf8"));

function repoWith(config, local) {
  const root = mkdtempSync(join(tmpdir(), "gdm-config-"));
  const dir = join(root, ".github-dev-methodology");
  mkdirSync(dir);
  if (config) writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  if (local) writeFileSync(join(dir, "config.local.json"), JSON.stringify(local));
  return root;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("loads the template, applies defaults and resolves features", () => {
  const root = repoWith(template);
  const loaded = loadRepoConfig(root);
  assert.equal(loaded.projectSlug, "my-project");
  assert.equal(loaded.path, join(loaded.root, ".github-dev-methodology/config.json"));
  assert.equal(loaded.project.merge.authority, "human");
  assert.equal(loaded.features.pr_loop, true);
  assert.equal(loaded.features.issue_schema, false);
});

test("defaults fill omitted optional sections", () => {
  const minimal = { schema_version: 1, active_project: "p", projects: { p: { preset: "full", org: "o", primary_repo: "r" } } };
  const { project } = loadRepoConfig(repoWith(minimal));
  assert.equal(project.review.poll_seconds, 60);
  assert.equal(project.review.wait_mode, "foreground");
  assert.deepEqual(project.merge, { authority: "human", scopes: [] });
  assert.equal(project.cache.copilot_bot_id, null);
});

test("config.local.json deep-merges over the committed file", () => {
  const local = { projects: { "my-project": { merge: { authority: "scoped", scopes: ["session-instruction"] }, review: { poll_seconds: 30 } } } };
  const { project } = loadRepoConfig(repoWith(template, local));
  assert.equal(project.merge.authority, "scoped");
  assert.deepEqual(project.merge.scopes, ["session-instruction"]);
  assert.equal(project.review.poll_seconds, 30);
  assert.equal(project.review.max_hours, 24);
  assert.equal(project.org, "my-org");
});

test("a local file that breaks the schema is reported", () => {
  const local = { projects: { "my-project": { merge: { authority: "root" } } } };
  assert.throws(() => loadRepoConfig(repoWith(template, local)), ConfigInvalidError);
});

test("missing config throws ConfigMissingError with the exact message", () => {
  const root = mkdtempSync(join(tmpdir(), "gdm-config-"));
  assert.throws(() => loadRepoConfig(root), (error) => {
    assert.ok(error instanceof ConfigMissingError);
    assert.equal(error.message, "no .github-dev-methodology/config.json found; run: gdm init");
    return true;
  });
});

test("unknown project and unknown nested key are distinct errors", () => {
  assert.throws(() => loadRepoConfig(repoWith(template), { project: "other" }), (error) => {
    assert.ok(error instanceof ProjectMissingError);
    assert.match(error.message, /known projects: my-project/);
    return true;
  });
  const broken = clone(template);
  broken.projects["my-project"].review.default_reviewer = "x";
  assert.throws(() => loadRepoConfig(repoWith(broken)), (error) => {
    assert.ok(error instanceof ConfigInvalidError);
    assert.match(error.message, /review\.default_reviewer: unknown key/);
    return true;
  });
});

test("the project option selects a non-active project", () => {
  const config = clone(template);
  config.projects.second = { preset: "full", org: "o2", primary_repo: "r2" };
  const loaded = loadRepoConfig(repoWith(config), { project: "second" });
  assert.equal(loaded.projectSlug, "second");
  assert.equal(loaded.features.stacked_prs, true);
});

test("a feature dependency violation is a ConfigInvalidError naming both flags", () => {
  const config = clone(template);
  config.projects["my-project"].features = { pr_loop: false };
  assert.throws(() => loadRepoConfig(repoWith(config)), (error) => {
    assert.ok(error instanceof ConfigInvalidError);
    assert.match(error.message, /copilot_review.*pr_loop/);
    return true;
  });
});

test("malformed JSON is reported with the file path", () => {
  const root = repoWith(null);
  writeFileSync(join(root, ".github-dev-methodology/config.json"), "{ nope");
  assert.throws(() => loadRepoConfig(root), /config\.json is invalid[\s\S]*not valid JSON/);
});

test("inside a git repo the root is the repository top level, from any subdirectory", () => {
  const root = repoWith(template);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const sub = join(root, "a", "b");
  mkdirSync(sub, { recursive: true });
  const loaded = loadRepoConfig(sub);
  assert.equal(loaded.path.endsWith(".github-dev-methodology/config.json"), true);
  assert.equal(loaded.root.endsWith(root.split("/").pop()), true);
});
