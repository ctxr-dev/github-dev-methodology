import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";

const legacyFixture = (name) => new URL(`./fixtures/legacy/${name}.config.legacy.md`, import.meta.url).pathname;

function scratchRepo(config) {
  const root = mkdtempSync(join(tmpdir(), "gdm-cfgcmd-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (config) {
    mkdirSync(join(root, ".github-dev-methodology"));
    writeFileSync(join(root, ".github-dev-methodology/config.json"), JSON.stringify(config));
  }
  return root;
}

async function gdm(argv, cwd) {
  const out = [];
  const err = [];
  const code = await main(argv, { cwd, stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } });
  return { code, out: out.join(""), err: err.join("") };
}

const sample = {
  schema_version: 1,
  active_project: "alpha",
  projects: {
    alpha: { preset: "pr-only", org: "acme", primary_repo: "widgets", features: { stacked_prs: true }, merge: { authority: "scoped", scopes: ["session-instruction"] } },
    beta: { preset: "full", org: "acme", primary_repo: "gadgets" },
  },
};

test("config get prints scalars raw and structures as JSON", async () => {
  const root = scratchRepo(sample);
  assert.deepEqual(await gdm(["config", "get", "merge.authority"], root), { code: 0, out: "scoped\n", err: "" });
  assert.equal((await gdm(["config", "get", "merge.scopes"], root)).out, '["session-instruction"]\n');
  assert.equal((await gdm(["config", "get", "review.poll_seconds"], root)).out, "60\n");
  assert.equal((await gdm(["config", "get", "cache.copilot_bot_id"], root)).out, "null\n");
});

test("config get reads top-level keys and resolved features", async () => {
  const root = scratchRepo(sample);
  assert.equal((await gdm(["config", "get", "active_project"], root)).out, "alpha\n");
  assert.equal((await gdm(["config", "get", "schema_version"], root)).out, "1\n");
  assert.equal((await gdm(["config", "get", "features.stacked_prs"], root)).out, "true\n");
  assert.equal((await gdm(["config", "get", "features.issue_schema"], root)).out, "false\n");
});

test("config get honours --project and fails on unknown keys and missing config", async () => {
  const root = scratchRepo(sample);
  assert.equal((await gdm(["config", "get", "primary_repo", "--project", "beta"], root)).out, "gadgets\n");
  const unknown = await gdm(["config", "get", "nope.nothing"], root);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /config key not found: nope\.nothing/);
  assert.equal((await gdm(["config", "get", "constructor"], root)).code, 1);
  const missing = await gdm(["config", "get", "org"], scratchRepo());
  assert.equal(missing.code, 1);
  assert.match(missing.err, /run: gdm init/);
  assert.equal((await gdm(["config", "get"], root)).code, 64);
});

test("config features lists flags and active references, in text and JSON", async () => {
  const root = scratchRepo(sample);
  const text = await gdm(["config", "features"], root);
  assert.equal(text.code, 0);
  assert.match(text.out, /^project: alpha \(preset pr-only\)$/m);
  assert.match(text.out, /^pr_loop: on$/m);
  assert.match(text.out, /^stacked_prs: on$/m);
  assert.match(text.out, /^issue_schema: off$/m);
  assert.match(text.out, /references\/pr-loop\.md/);
  assert.doesNotMatch(text.out, /references\/issue-schema\.md/);
  const json = JSON.parse((await gdm(["config", "features", "--json"], root)).out);
  assert.equal(json.project, "alpha");
  assert.equal(json.flags.worktrees, true);
  assert.ok(json.docs.includes("worktrees-and-stacks.md"));
  assert.ok(!json.docs.includes("issue-schema.md"));
});

test("config migrate prints v1 JSON on stdout and not-migrated lines on stderr", async () => {
  const root = scratchRepo();
  const result = await gdm(["config", "migrate", legacyFixture("tradingtune")], root);
  assert.equal(result.code, 0);
  const config = JSON.parse(result.out);
  assert.deepEqual(config.projects.tradingtune.review.reviewers, []);
  assert.equal(config.projects.tradingtune.features.copilot_review, false);
  assert.equal(config.projects.tradingtune.features.subagent_review, false);
  assert.match(result.err, /^not migrated: Proportionality/m);
  assert.equal(existsSync(join(root, ".github-dev-methodology/config.json")), false);
});

test("config migrate on the ctxr-dev fixture yields both projects", async () => {
  const result = await gdm(["config", "migrate", legacyFixture("ctxr-dev")], scratchRepo());
  assert.equal(result.code, 0);
  assert.deepEqual(Object.keys(JSON.parse(result.out).projects), ["ctxr-dev", "omp-plugins"]);
});

test("config migrate --write writes the repo config, which then loads and passes doctor-grade validation", async () => {
  const root = scratchRepo();
  const result = await gdm(["config", "migrate", legacyFixture("ctxr-dev"), "--write"], root);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /wrote .*\.github-dev-methodology\/config\.json/);
  const written = JSON.parse(readFileSync(join(root, ".github-dev-methodology/config.json"), "utf8"));
  assert.equal(written.active_project, "ctxr-dev");
  assert.equal((await gdm(["config", "get", "preset", "--project", "omp-plugins"], root)).out, "single-issue\n");
});

test("config migrate --write refuses to overwrite an existing config", async () => {
  const root = scratchRepo(sample);
  const before = readFileSync(join(root, ".github-dev-methodology/config.json"), "utf8");
  const result = await gdm(["config", "migrate", legacyFixture("tradingtune"), "--write"], root);
  assert.equal(result.code, 1);
  assert.match(result.err, /config exists/);
  assert.equal(readFileSync(join(root, ".github-dev-methodology/config.json"), "utf8"), before);
});

test("config migrate fails on an unreadable file and on a template with no real project", async () => {
  const root = scratchRepo();
  assert.equal((await gdm(["config", "migrate", join(root, "missing.md")], root)).code, 1);
  const template = await gdm(["config", "migrate", legacyFixture("template"), "--write"], root);
  assert.equal(template.code, 1);
  assert.equal(existsSync(join(root, ".github-dev-methodology/config.json")), false);
});
