import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPENDENCIES, FEATURE_DOCS, FLAGS, PRESETS, activeDocs, resolveFeatures } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/features.mjs";

const trueFlags = (flags) => FLAGS.filter((flag) => flags[flag]);

test("FLAGS lists the 15 flags in contract order", () => {
  assert.equal(FLAGS.length, 15);
  assert.equal(FLAGS[0], "pr_loop");
  assert.equal(FLAGS[14], "stacked_prs");
});

test("presets resolve to the documented sets", () => {
  assert.deepEqual(trueFlags(resolveFeatures({ preset: "pr-only" }).flags), PRESETS["pr-only"]);
  assert.deepEqual(
    trueFlags(resolveFeatures({ preset: "single-issue" }).flags).sort(),
    [...PRESETS["pr-only"], "issue_schema", "issue_lifecycle", "subagent_review"].sort(),
  );
  assert.equal(trueFlags(resolveFeatures({ preset: "full" }).flags).length, 15);
});

test("per-key overrides apply on top of the preset", () => {
  const { flags, errors } = resolveFeatures({ preset: "pr-only", features: { worktrees: false, stacked_prs: true } });
  assert.deepEqual(errors, []);
  assert.equal(flags.worktrees, false);
  assert.equal(flags.stacked_prs, true);
  assert.equal(flags.pr_loop, true);
});

test("a flag that is on while its parent is off names both flags", () => {
  for (const [flag, parent] of Object.entries(DEPENDENCIES)) {
    const features = { [flag]: true, [parent]: false };
    const { errors } = resolveFeatures({ preset: "full", features });
    assert.ok(
      errors.some((message) => message.includes(flag) && message.includes(parent)),
      flag + " -> " + parent + " not reported: " + JSON.stringify(errors),
    );
  }
});

test("dependency parents match the contract", () => {
  assert.deepEqual(DEPENDENCIES, {
    copilot_review: "pr_loop",
    stacked_prs: "pr_loop",
    subagent_review: "agents_orchestration",
    plan_to_issues: "issue_schema",
    parallel_validation: "plan_to_issues",
    plan_deprecation: "plan_to_issues",
    cold_start: "issue_schema",
  });
});

test("unknown flag, non-boolean value and unknown preset are errors", () => {
  assert.match(resolveFeatures({ preset: "full", features: { nope: true } }).errors[0], /unknown feature flag "nope"/);
  assert.match(resolveFeatures({ preset: "full", features: { worktrees: "yes" } }).errors[0], /worktrees/);
  assert.match(resolveFeatures({ preset: "huge" }).errors[0], /unknown preset "huge"/);
  assert.match(resolveFeatures({}).errors[0], /unknown preset/);
});

test("activeDocs maps enabled flags to reference files", () => {
  const { flags } = resolveFeatures({ preset: "pr-only" });
  assert.deepEqual(activeDocs(flags), [
    "pr-loop.md",
    "commits.md",
    "agents-orchestration.md",
    "audit-vs-execute.md",
    "worktrees-and-stacks.md",
  ]);
  assert.equal(Object.keys(FEATURE_DOCS).length, 12);
});
