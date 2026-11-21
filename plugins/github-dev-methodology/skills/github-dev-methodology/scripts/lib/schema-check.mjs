import { FLAGS } from "./features.mjs";

const PRESET_NAMES = ["pr-only", "single-issue", "full"];
const WAIT_MODES = ["foreground", "wakeup"];
const MERGE_AUTHORITIES = ["human", "scoped", "autonomous"];
const MERGE_SCOPES = ["dependabot-green", "session-instruction"];
const POST_MIGRATION_MODES = ["minimize", "delete"];
const PROJECT_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const text = (path, value) =>
  typeof value === "string" && value.length > 0 ? [] : [`${path}: must be a non-empty string`];

const nullableText = (path, value) => (value === null ? [] : text(path, value));

const bool = (path, value) => (typeof value === "boolean" ? [] : [`${path}: must be true or false`]);

const positiveInteger = (path, value) =>
  Number.isInteger(value) && value >= 1 ? [] : [`${path}: must be an integer >= 1`];

const oneOf = (allowed) => (path, value) =>
  allowed.includes(value) ? [] : [`${path}: must be one of ${allowed.join(", ")}`];

const listOf = (itemRule, { unique = false } = {}) => (path, value) => {
  if (!Array.isArray(value)) return [`${path}: must be an array`];
  const errors = value.flatMap((item, index) => itemRule(`${path}[${index}]`, item));
  if (unique && new Set(value).size !== value.length) errors.push(`${path}: items must be unique`);
  return errors;
};

const shape = (properties, required = []) => (path, value) => {
  if (!isObject(value)) return [`${path}: must be an object`];
  const errors = required.filter((key) => !(key in value)).map((key) => `${path}.${key}: is required`);
  for (const [key, child] of Object.entries(value)) {
    const rule = properties[key];
    if (rule) errors.push(...rule(`${path}.${key}`, child));
    else errors.push(`${path}.${key}: unknown key`);
  }
  return errors;
};

const mapOf = (keyPattern, valueRule, { minimum = 0 } = {}) => (path, value) => {
  if (!isObject(value)) return [`${path}: must be an object`];
  const keys = Object.keys(value);
  const errors = keys.length < minimum ? [`${path}: needs at least ${minimum} entry`] : [];
  for (const key of keys) {
    if (!keyPattern.test(key)) errors.push(`${path}.${key}: invalid name`);
    errors.push(...valueRule(`${path}.${key}`, value[key]));
  }
  return errors;
};

const schemaVersion = (path, value) => (value === 1 ? [] : [`${path}: must be 1`]);

const featureOverrides = shape(Object.fromEntries(FLAGS.map((flag) => [flag, bool])));

const reviewRule = shape({
  reviewers: listOf(text),
  required_reviewers: listOf(text),
  bot_review_timeout_minutes: positiveInteger,
  poll_seconds: positiveInteger,
  max_hours: positiveInteger,
  wait_mode: oneOf(WAIT_MODES),
});

const mergeRule = shape({
  authority: oneOf(MERGE_AUTHORITIES),
  scopes: listOf(oneOf(MERGE_SCOPES), { unique: true }),
});

const projectRule = shape(
  {
    preset: oneOf(PRESET_NAMES),
    features: featureOverrides,
    org: text,
    primary_repo: text,
    sibling_repos: listOf(text),
    project_url: nullableText,
    review: reviewRule,
    merge: mergeRule,
    plans: shape({ post_migration: oneOf(POST_MIGRATION_MODES) }),
    cache: shape({ copilot_bot_id: nullableText }),
  },
  ["preset", "org", "primary_repo"],
);

const repoConfigRule = shape(
  {
    $schema: text,
    schema_version: schemaVersion,
    active_project: text,
    projects: mapOf(PROJECT_SLUG, projectRule, { minimum: 1 }),
  },
  ["schema_version", "active_project", "projects"],
);

const userConfigRule = shape({ schema_version: schemaVersion, worktrees_root: text }, ["schema_version"]);

export function validateRepoConfig(config) {
  return repoConfigRule("config", config);
}

export function validateUserConfig(config) {
  return userConfigRule("config", config);
}
