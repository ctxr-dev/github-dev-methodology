export const FLAGS = [
  "pr_loop",
  "copilot_review",
  "conventional_commits",
  "agents_orchestration",
  "audit_vs_execute",
  "issue_schema",
  "issue_lifecycle",
  "label_taxonomy",
  "plan_to_issues",
  "parallel_validation",
  "plan_deprecation",
  "cold_start",
  "subagent_review",
  "worktrees",
  "stacked_prs",
];

const PR_ONLY = [
  "pr_loop",
  "copilot_review",
  "conventional_commits",
  "agents_orchestration",
  "audit_vs_execute",
  "worktrees",
];

export const PRESETS = {
  "pr-only": PR_ONLY,
  "single-issue": [...PR_ONLY, "issue_schema", "issue_lifecycle", "subagent_review"],
  full: FLAGS,
};

export const DEPENDENCIES = {
  copilot_review: "pr_loop",
  stacked_prs: "pr_loop",
  subagent_review: "agents_orchestration",
  plan_to_issues: "issue_schema",
  parallel_validation: "plan_to_issues",
  plan_deprecation: "plan_to_issues",
  cold_start: "issue_schema",
};

export const FEATURE_DOCS = {
  pr_loop: "pr-loop.md",
  issue_lifecycle: "issue-lifecycle.md",
  issue_schema: "issue-schema.md",
  label_taxonomy: "label-taxonomy.md",
  plan_to_issues: "plan-to-issues.md",
  parallel_validation: "parallel-validation.md",
  plan_deprecation: "plan-deprecation.md",
  cold_start: "cold-start.md",
  conventional_commits: "commits.md",
  audit_vs_execute: "audit-vs-execute.md",
  agents_orchestration: "agents-orchestration.md",
  worktrees: "worktrees-and-stacks.md",
};

function presetFlags(preset, errors) {
  if (!Object.hasOwn(PRESETS, preset)) {
    errors.push(`unknown preset "${preset}"; expected one of ${Object.keys(PRESETS).join(", ")}`);
    return {};
  }
  return Object.fromEntries(FLAGS.map((flag) => [flag, PRESETS[preset].includes(flag)]));
}

function applyOverrides(flags, overrides, errors) {
  for (const [flag, value] of Object.entries(overrides ?? {})) {
    if (!FLAGS.includes(flag)) {
      errors.push(`unknown feature flag "${flag}"`);
    } else if (typeof value !== "boolean") {
      errors.push(`feature flag "${flag}" must be true or false`);
    } else {
      flags[flag] = value;
    }
  }
}

function dependencyErrors(flags) {
  return Object.entries(DEPENDENCIES)
    .filter(([flag, parent]) => flags[flag] && !flags[parent])
    .map(([flag, parent]) => `feature "${flag}" requires "${parent}", which is off`);
}

export function resolveFeatures(project) {
  const errors = [];
  const flags = presetFlags(project?.preset, errors);
  if (errors.length > 0) return { flags: {}, errors };
  applyOverrides(flags, project.features, errors);
  errors.push(...dependencyErrors(flags));
  return { flags, errors };
}

export function activeDocs(flags) {
  return FLAGS.filter((flag) => flags[flag] && FEATURE_DOCS[flag]).map((flag) => FEATURE_DOCS[flag]);
}
