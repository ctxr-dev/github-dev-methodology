import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigInvalidError, ConfigMissingError, NotGitRepoError, ProjectMissingError } from "./errors.mjs";
import { resolveFeatures } from "./features.mjs";
import { repoConfigDir } from "./paths.mjs";
import { repoRoot, spawnGit } from "./repo-identity.mjs";
import { validateRepoConfig } from "./schema-check.mjs";

export const PROJECT_DEFAULTS = {
  features: {},
  sibling_repos: [],
  project_url: null,
  review: {
    reviewers: [],
    required_reviewers: [],
    bot_review_timeout_minutes: 15,
    poll_seconds: 60,
    max_hours: 24,
    wait_mode: "foreground",
  },
  merge: { authority: "human", scopes: [] },
  plans: { post_migration: "minimize" },
  cache: { copilot_bot_id: null },
};

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return merged;
}

function readJsonFile(path, { optional }) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && optional) return null;
    if (error.code === "ENOENT") throw new ConfigMissingError();
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigInvalidError(path, [`not valid JSON: ${error.message}`]);
  }
}

function findRoot(cwd, git) {
  try {
    return repoRoot(cwd, git);
  } catch (error) {
    if (error instanceof NotGitRepoError) return resolve(cwd);
    throw error;
  }
}

function selectProject(config, requested, path) {
  const slug = requested ?? config.active_project;
  if (!Object.hasOwn(config.projects, slug)) {
    const known = Object.keys(config.projects).join(", ");
    throw new ProjectMissingError(`project "${slug}" not found in ${path}; known projects: ${known}`);
  }
  return slug;
}

export function loadRepoConfig(cwd, { project, git = spawnGit } = {}) {
  const root = findRoot(cwd, git);
  const dir = repoConfigDir(root);
  const path = join(dir, "config.json");
  const committed = readJsonFile(path, { optional: false });
  const local = readJsonFile(join(dir, "config.local.json"), { optional: true });
  const config = local === null ? committed : deepMerge(committed, local);
  const errors = validateRepoConfig(config);
  if (errors.length > 0) throw new ConfigInvalidError(path, errors);
  const projectSlug = selectProject(config, project, path);
  const resolvedProject = deepMerge(PROJECT_DEFAULTS, config.projects[projectSlug]);
  const features = resolveFeatures(resolvedProject);
  if (features.errors.length > 0) throw new ConfigInvalidError(`${path} (project ${projectSlug})`, features.errors);
  return { root, path, config, projectSlug, project: resolvedProject, features: features.flags };
}
