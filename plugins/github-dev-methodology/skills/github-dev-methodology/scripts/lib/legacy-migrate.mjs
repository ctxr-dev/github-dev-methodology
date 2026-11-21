import { PROJECT_DEFAULTS } from "./config.mjs";
import { FLAGS, PRESETS, resolveFeatures } from "./features.mjs";
import { LEGACY_FEATURE_NAMES, parseBool, parseLegacyConfig } from "./legacy-config.mjs";
import { validateRepoConfig } from "./schema-check.mjs";
import { readAssetJson } from "./setup-assets.mjs";

const MAPPED_KEYS = new Set([
  ...FLAGS,
  "project_url",
  "org",
  "primary_repo",
  "sibling_repos",
  "reviewers",
  "default_reviewer",
  "required_reviewers",
  "pr_loop_poll_seconds",
  "pr_loop_max_hours",
  "plan_post_migration",
  "copilot_bot_id",
]);
const EMPTY_LIST_MARKER = /^(none|ask)\b/i;

function splitList(value) {
  if (value === undefined || value === "" || EMPTY_LIST_MARKER.test(value)) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function nullIfEmpty(value) {
  return value === undefined || value === "" ? null : value;
}

function matchingPreset(flags) {
  const matches = (preset) => LEGACY_FEATURE_NAMES.every((flag) => flags[flag] === PRESETS[preset].includes(flag));
  return Object.keys(PRESETS).find(matches) ?? "full";
}

function positiveInteger(rows, key, fallback, report) {
  if (rows[key] === undefined || rows[key] === "") return fallback;
  const parsed = Number(rows[key]);
  if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  report(`${key} (invalid value ${JSON.stringify(rows[key])})`);
  return fallback;
}

function planPostMigration(rows, report) {
  const value = rows.plan_post_migration;
  if (value === undefined || value === "") return PROJECT_DEFAULTS.plans.post_migration;
  if (value === "minimize" || value === "delete") return value;
  report(`plan_post_migration (invalid value ${JSON.stringify(value)})`);
  return PROJECT_DEFAULTS.plans.post_migration;
}

function reviewers(rows, report) {
  if (rows.reviewers !== undefined) {
    if (rows.default_reviewer !== undefined) report("default_reviewer");
    return splitList(rows.reviewers);
  }
  return splitList(rows.default_reviewer);
}

function reportDroppedKeys(rows, report) {
  Object.keys(rows).filter((key) => !MAPPED_KEYS.has(key)).forEach(report);
}

function migrateProject(parsed, templateProject, report) {
  const { rows } = parsed;
  const features = Object.fromEntries(FLAGS.map((flag) => [flag, parseBool(rows[flag])]));
  parsed.unmappedHeadings.forEach(report);
  reportDroppedKeys(rows, report);
  return {
    ...templateProject,
    preset: matchingPreset(features),
    features,
    org: rows.org ?? "",
    primary_repo: rows.primary_repo ?? "",
    sibling_repos: splitList(rows.sibling_repos),
    project_url: nullIfEmpty(rows.project_url),
    review: {
      ...PROJECT_DEFAULTS.review,
      reviewers: reviewers(rows, report),
      required_reviewers: splitList(rows.required_reviewers),
      poll_seconds: positiveInteger(rows, "pr_loop_poll_seconds", PROJECT_DEFAULTS.review.poll_seconds, report),
      max_hours: positiveInteger(rows, "pr_loop_max_hours", PROJECT_DEFAULTS.review.max_hours, report),
    },
    merge: { ...PROJECT_DEFAULTS.merge },
    plans: { post_migration: planPostMigration(rows, report) },
    cache: { copilot_bot_id: nullIfEmpty(rows.copilot_bot_id) },
  };
}

function chooseActiveProject(parsed, notMigrated) {
  const slugs = parsed.projects.map((project) => project.slug);
  if (slugs.includes(parsed.activeProject)) return parsed.activeProject;
  if (parsed.activeProject !== "") notMigrated.push(`active_project (${parsed.activeProject} matches no project)`);
  return slugs[0];
}

function validationErrors(config) {
  const errors = validateRepoConfig(config);
  if (errors.length > 0) return errors;
  return Object.entries(config.projects).flatMap(([slug, project]) =>
    resolveFeatures(project).errors.map((error) => `project ${slug}: ${error}`),
  );
}

export function migrateLegacyConfig(text) {
  const parsed = parseLegacyConfig(text);
  const notMigrated = [...parsed.strayHeadings];
  if (parsed.projects.length === 0) {
    return { config: null, notMigrated, errors: ["no `## Project: <slug>` section found"] };
  }
  const template = readAssetJson("config.template.json");
  const [templateProject] = Object.values(template.projects);
  const projects = {};
  for (const project of parsed.projects) {
    const report = (item) => notMigrated.push(`${item} (project ${project.slug})`);
    projects[project.slug] = migrateProject(project, templateProject, report);
  }
  const config = {
    ...template,
    active_project: chooseActiveProject(parsed, notMigrated),
    projects,
  };
  return { config, notMigrated, errors: validationErrors(config) };
}
