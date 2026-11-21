import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FLAGS } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/features.mjs";
import { parseBool, parseLegacyConfig } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/legacy-config.mjs";
import { migrateLegacyConfig } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/legacy-migrate.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/legacy/${name}.config.legacy.md`, import.meta.url), "utf8");

test("parseBool accepts the legacy truthy spellings only", () => {
  for (const value of ["true", "YES", " on ", "1"]) assert.equal(parseBool(value), true, value);
  for (const value of ["false", "no", "", undefined, "maybe"]) assert.equal(parseBool(value), false, String(value));
});

test("parser reads sections, rows, template placeholders and stray headings", () => {
  const parsed = parseLegacyConfig(fixture("ctxr-dev"));
  assert.equal(parsed.activeProject, "ctxr-dev");
  assert.deepEqual(parsed.projects.map((project) => project.slug), ["ctxr-dev", "omp-plugins"]);
  assert.equal(parsed.projects[0].rows.default_reviewer, "copilot");
  assert.equal(parsed.projects[1].rows.project_url, "");
  assert.equal(parsed.projects[1].rows.required_reviewers, "");
  assert.deepEqual(parsed.strayHeadings, ["Notes for the agent"]);
});

test("tradingtune: no reviewers, copilot and subagent review off, Proportionality reported", () => {
  const { config, notMigrated, errors } = migrateLegacyConfig(fixture("tradingtune"));
  assert.deepEqual(errors, []);
  const project = config.projects.tradingtune;
  assert.equal(config.active_project, "tradingtune");
  assert.deepEqual(project.review.reviewers, []);
  assert.deepEqual(project.review.required_reviewers, []);
  assert.equal(project.features.copilot_review, false);
  assert.equal(project.features.subagent_review, false);
  assert.equal(project.features.worktrees, false);
  assert.equal(project.features.stacked_prs, false);
  assert.deepEqual(Object.keys(project.features), FLAGS);
  assert.equal(project.preset, "full");
  assert.equal(project.review.poll_seconds, 300);
  assert.equal(project.review.max_hours, 24);
  assert.equal(project.plans.post_migration, "delete");
  assert.deepEqual(project.sibling_repos, ["browser-plugin", "landing"]);
  assert.equal(project.project_url, "https://github.com/orgs/tradingtune/projects/1/views/1");
  assert.deepEqual(project.merge, { authority: "human", scopes: [] });
  assert.ok(notMigrated.some((item) => item.startsWith("Proportionality")));
  assert.ok(notMigrated.includes("default_dev_loop_mode (project tradingtune)"));
  assert.ok(notMigrated.some((item) => item.startsWith("GitHub native Issue Types")));
});

test("ctxr-dev: both projects migrate with their own reviewers, presets and cache", () => {
  const { config, notMigrated, errors } = migrateLegacyConfig(fixture("ctxr-dev"));
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(config.projects), ["ctxr-dev", "omp-plugins"]);
  assert.equal(config.active_project, "ctxr-dev");
  const main = config.projects["ctxr-dev"];
  assert.deepEqual(main.review.reviewers, ["copilot"]);
  assert.equal(main.cache.copilot_bot_id, "BOT_kgDOCnlnWA");
  assert.equal(main.preset, "full");
  assert.equal(main.features.copilot_review, true);
  assert.equal(main.features.subagent_review, false);
  assert.equal(main.plans.post_migration, "minimize");
  assert.deepEqual(main.sibling_repos, ["skill-code-review", "fsm", "skill-llm-wiki", "mcp-github", "llm-wiki-memory"]);
  const plugins = config.projects["omp-plugins"];
  assert.equal(plugins.preset, "single-issue");
  assert.equal(plugins.project_url, null);
  assert.deepEqual(plugins.review.reviewers, ["copilot"]);
  assert.deepEqual(plugins.review.required_reviewers, []);
  assert.equal(plugins.review.poll_seconds, 60);
  assert.equal(plugins.features.subagent_review, true);
  assert.ok(notMigrated.includes("pr_loop_wait_for (project omp-plugins)"));
  assert.ok(notMigrated.includes("default_dev_loop_mode (project ctxr-dev)"));
  assert.ok(notMigrated.includes("Notes for the agent"));
});

test("default_reviewer is reported when reviewers is also present", () => {
  const text = "## Active\n\n| Key | Value |\n|---|---|\n| `active_project` | p |\n\n## Project: p\n\n| Key | Value |\n|---|---|\n| `org` | o |\n| `primary_repo` | r |\n| `reviewers` | alice |\n| `default_reviewer` | copilot |\n";
  const { config, notMigrated } = migrateLegacyConfig(text);
  assert.deepEqual(config.projects.p.review.reviewers, ["alice"]);
  assert.ok(notMigrated.includes("default_reviewer (project p)"));
});

test("an unfilled template reports validation errors and yields no usable project name", () => {
  const { errors } = migrateLegacyConfig(fixture("template"));
  assert.ok(errors.length > 0);
});

test("text without a project section is an error", () => {
  const { config, errors } = migrateLegacyConfig("# nothing here\n");
  assert.equal(config, null);
  assert.match(errors[0], /no `## Project/);
});

test("an active_project that matches nothing falls back to the first project and is reported", () => {
  const text = "## Active\n\n| `active_project` | ghost |\n\n## Project: real\n\n| `org` | o |\n| `primary_repo` | r |\n";
  const { config, notMigrated } = migrateLegacyConfig(text);
  assert.equal(config.active_project, "real");
  assert.ok(notMigrated.some((item) => item.startsWith("active_project (ghost")));
});

test("a legacy feature set that breaks a dependency is reported as an error", () => {
  const text = "## Project: p\n\n| `org` | o |\n| `primary_repo` | r |\n| `copilot_review` | true |\n";
  const { errors } = migrateLegacyConfig(text);
  assert.ok(errors.some((error) => error.includes("copilot_review") && error.includes("pr_loop")));
});
