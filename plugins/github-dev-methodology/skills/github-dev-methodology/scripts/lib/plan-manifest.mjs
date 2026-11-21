import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConfigInvalidError, GdmError } from "./errors.mjs";

const MANIFEST_KEYS = ["plan_id", "repo", "project_url", "items"];
const ITEM_KEYS = ["key", "title", "type", "body_file", "parent", "blocked_by", "repo", "labels", "fields", "project_fields"];
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PROJECT_URL_PATTERN = /^https:\/\/github\.com\/(orgs|users)\/([^/]+)\/projects\/(\d+)$/;
const ISSUE_URL_PATTERN = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_-]+)\}\}/g;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isScalar = (value) => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
const isStringList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string");

export function parseRepoRef(text) {
  const [owner, repo] = text.split("/");
  return { host: "github.com", owner, repo };
}

export function parseIssueUrl(url) {
  const match = ISSUE_URL_PATTERN.exec(url);
  if (!match) return null;
  return { host: match[1], owner: match[2], repo: match[3], number: Number(match[4]) };
}

export function parseProjectUrl(url) {
  const match = PROJECT_URL_PATTERN.exec(url);
  if (!match) return null;
  return { scope: match[1] === "orgs" ? "organization" : "user", login: match[2], number: Number(match[3]) };
}

export function issueRef(url, fromRepo) {
  const parsed = parseIssueUrl(url);
  const sameRepo = `${parsed.owner}/${parsed.repo}`.toLowerCase() === fromRepo.toLowerCase();
  return sameRepo ? `#${parsed.number}` : `${parsed.owner}/${parsed.repo}#${parsed.number}`;
}

export function placeholderKeys(text) {
  return [...new Set([...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]))];
}

export function renderPlaceholders(text, resolveKey) {
  const missing = [];
  const rendered = text.replace(PLACEHOLDER_PATTERN, (whole, key) => {
    const value = resolveKey(key);
    if (value === null) {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    return value;
  });
  return { text: rendered, missing };
}

function unknownKeys(node, allowed, label) {
  return Object.keys(node).filter((key) => !allowed.includes(key)).map((key) => `${label}: unknown key "${key}"`);
}

function checkFieldMap(value, label, errors) {
  if (!isObject(value)) return errors.push(`${label} must be an object`);
  for (const [name, entry] of Object.entries(value)) {
    if (!isScalar(entry)) errors.push(`${label}.${name} must be a string or a number`);
  }
}

function checkItemShape(item, label, errors) {
  errors.push(...unknownKeys(item, ITEM_KEYS, label));
  if (typeof item.key !== "string" || !KEY_PATTERN.test(item.key)) errors.push(`${label}: key must match ${KEY_PATTERN}`);
  if (typeof item.title !== "string" || item.title.trim() === "") errors.push(`${label}: title is required`);
  if (typeof item.body_file !== "string" || item.body_file === "") errors.push(`${label}: body_file is required`);
  if (item.type != null && typeof item.type !== "string") errors.push(`${label}: type must be a string or null`);
  if (item.parent != null && typeof item.parent !== "string") errors.push(`${label}: parent must be a key or null`);
  if (item.blocked_by != null && !isStringList(item.blocked_by)) errors.push(`${label}: blocked_by must be a list of keys`);
  if (item.labels != null && !isStringList(item.labels)) errors.push(`${label}: labels must be a list of strings`);
  if (item.repo != null && !REPO_PATTERN.test(item.repo)) errors.push(`${label}: repo must be owner/repo or null`);
  if (item.fields != null) checkFieldMap(item.fields, `${label}.fields`, errors);
  if (item.project_fields != null) checkFieldMap(item.project_fields, `${label}.project_fields`, errors);
}

function checkManifestShape(manifest, errors) {
  if (!isObject(manifest)) return errors.push("manifest must be a JSON object");
  errors.push(...unknownKeys(manifest, MANIFEST_KEYS, "manifest"));
  if (typeof manifest.plan_id !== "string" || !PLAN_ID_PATTERN.test(manifest.plan_id)) errors.push(`manifest: plan_id must match ${PLAN_ID_PATTERN}`);
  if (typeof manifest.repo !== "string" || !REPO_PATTERN.test(manifest.repo)) errors.push("manifest: repo must be owner/repo");
  if (manifest.project_url != null && !parseProjectUrl(String(manifest.project_url))) errors.push("manifest: project_url must be https://github.com/(orgs|users)/<login>/projects/<n> or null");
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) return errors.push("manifest: items must be a non-empty list");
  manifest.items.forEach((item, index) => {
    if (isObject(item)) checkItemShape(item, `items[${index}]`, errors);
    else errors.push(`items[${index}] must be an object`);
  });
}

function checkReferences(items, errors) {
  const keys = new Set();
  for (const item of items) {
    if (keys.has(item.key)) errors.push(`duplicate key "${item.key}"`);
    keys.add(item.key);
  }
  for (const item of items) {
    const references = [item.parent, ...item.blockedBy].filter(Boolean);
    for (const reference of references) {
      if (!keys.has(reference)) errors.push(`${item.key}: refers to unknown key "${reference}"`);
      if (reference === item.key) errors.push(`${item.key}: refers to itself`);
    }
  }
}

function readBodies(rawItems, baseDir, errors) {
  return rawItems.map((raw) => {
    let body = "";
    try {
      body = readFileSync(resolve(baseDir, raw.body_file), "utf8");
    } catch {
      errors.push(`${raw.key}: body file not found: ${raw.body_file}`);
    }
    return {
      key: raw.key,
      title: raw.title,
      type: raw.type ?? null,
      body,
      parent: raw.parent ?? null,
      blockedBy: raw.blocked_by ?? [],
      repo: raw.repo ?? null,
      labels: raw.labels ?? [],
      fields: raw.fields ?? {},
      projectFields: raw.project_fields ?? {},
    };
  });
}

export function loadManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new GdmError(`cannot read manifest ${path}: ${error.message}`);
  }
  const errors = [];
  checkManifestShape(manifest, errors);
  if (errors.length > 0) throw new ConfigInvalidError(path, errors);
  const items = readBodies(manifest.items, dirname(resolve(path)), errors);
  checkReferences(items, errors);
  if (errors.length > 0) throw new ConfigInvalidError(path, errors);
  return { planId: manifest.plan_id, repo: manifest.repo, projectUrl: manifest.project_url ?? null, items };
}

export function orderItems(items) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const remaining = new Map(items.map((item) => [item.key, new Set([item.parent, ...item.blockedBy].filter(Boolean))]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.keys()].find((key) => remaining.get(key).size === 0);
    if (ready === undefined) {
      throw new GdmError(`dependency cycle among: ${[...remaining.keys()].join(", ")}`);
    }
    remaining.delete(ready);
    remaining.forEach((dependencies) => dependencies.delete(ready));
    ordered.push(byKey.get(ready));
  }
  return ordered;
}
