import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FLAGS } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/features.mjs";
import { validateRepoConfig, validateUserConfig } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/schema-check.mjs";

const assets = new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/assets/", import.meta.url);
const readAsset = (name) => JSON.parse(readFileSync(new URL(name, assets), "utf8"));
const validConfig = () => readAsset("config.template.json");
const withProject = (patch) => {
  const config = validConfig();
  Object.assign(config.projects["my-project"], patch);
  return config;
};

test("the shipped template is a valid instance", () => {
  assert.deepEqual(validateRepoConfig(validConfig()), []);
  assert.deepEqual(validateUserConfig(readAsset("user-config.template.json")), []);
});

test("a minimal project needs only preset, org and primary_repo", () => {
  const config = { schema_version: 1, active_project: "p", projects: { p: { preset: "full", org: "o", primary_repo: "r" } } };
  assert.deepEqual(validateRepoConfig(config), []);
});

test("required keys are reported", () => {
  assert.deepEqual(validateRepoConfig({}).sort(), [
    "config.active_project: is required",
    "config.projects: is required",
    "config.schema_version: is required",
  ]);
  const errors = validateRepoConfig({ schema_version: 1, active_project: "p", projects: { p: {} } });
  assert.deepEqual(errors.sort(), [
    "config.projects.p.org: is required",
    "config.projects.p.preset: is required",
    "config.projects.p.primary_repo: is required",
  ]);
});

test("unknown keys are rejected at every level", () => {
  assert.deepEqual(validateRepoConfig({ ...validConfig(), extra: 1 }), ["config.extra: unknown key"]);
  assert.deepEqual(validateRepoConfig(withProject({ surprise: 1 })), ["config.projects.my-project.surprise: unknown key"]);
  const nested = withProject({ review: { ...validConfig().projects["my-project"].review, default_reviewer: "x" } });
  assert.deepEqual(validateRepoConfig(nested), ["config.projects.my-project.review.default_reviewer: unknown key"]);
  const merge = withProject({ merge: { authority: "human", scopes: [], mode: "x" } });
  assert.deepEqual(validateRepoConfig(merge), ["config.projects.my-project.merge.mode: unknown key"]);
  assert.deepEqual(validateRepoConfig(withProject({ features: { nope: true } })), [
    "config.projects.my-project.features.nope: unknown key",
  ]);
  assert.deepEqual(validateUserConfig({ schema_version: 1, other: 1 }), ["config.other: unknown key"]);
});

test("enums and types are enforced", () => {
  const bad = (patch) => validateRepoConfig(withProject(patch));
  assert.match(bad({ preset: "tiny" })[0], /preset: must be one of pr-only, single-issue, full/);
  assert.match(bad({ merge: { authority: "root" } })[0], /merge.authority: must be one of human, scoped, autonomous/);
  assert.match(bad({ merge: { scopes: ["everything"] } })[0], /merge.scopes\[0\]: must be one of/);
  assert.match(bad({ merge: { scopes: ["dependabot-green", "dependabot-green"] } })[0], /must be unique|unique/);
  assert.match(bad({ review: { wait_mode: "poll" } })[0], /wait_mode: must be one of foreground, wakeup/);
  assert.match(bad({ review: { poll_seconds: 0 } })[0], /poll_seconds: must be an integer >= 1/);
  assert.match(bad({ review: { reviewers: "copilot" } })[0], /reviewers: must be an array/);
  assert.match(bad({ plans: { post_migration: "keep" } })[0], /post_migration: must be one of minimize, delete/);
  assert.match(bad({ features: { worktrees: "yes" } })[0], /features.worktrees: must be true or false/);
  assert.match(bad({ project_url: 5 })[0], /project_url/);
  assert.match(bad({ cache: { copilot_bot_id: "" } })[0], /copilot_bot_id/);
  assert.match(validateRepoConfig({ ...validConfig(), schema_version: 2 })[0], /schema_version: must be 1/);
  assert.match(validateRepoConfig({ ...validConfig(), projects: {} })[0], /needs at least 1/);
  assert.match(validateRepoConfig([])[0], /must be an object/);
});

test("the JSON Schema asset mirrors the validator's flags, enums and strictness", () => {
  const schema = readAsset("config.schema.json");
  const project = schema.$defs.project;
  assert.deepEqual(Object.keys(project.properties.features.properties), FLAGS);
  assert.equal(schema.additionalProperties, false);
  assert.equal(project.additionalProperties, false);
  assert.deepEqual(project.required, ["preset", "org", "primary_repo"]);
  assert.deepEqual(project.properties.preset.enum, ["pr-only", "single-issue", "full"]);
  assert.deepEqual(project.properties.merge.properties.authority.enum, ["human", "scoped", "autonomous"]);
  assert.deepEqual(project.properties.review.properties.wait_mode.enum, ["foreground", "wakeup"]);
  assert.deepEqual(project.properties.plans.properties.post_migration.enum, ["minimize", "delete"]);
  assert.deepEqual(project.properties.merge.properties.scopes.items.enum, ["dependabot-green", "session-instruction"]);
  assert.equal(validConfig().$schema.endsWith("/v1.0.0/plugins/github-dev-methodology/skills/github-dev-methodology/assets/config.schema.json"), true);
});
