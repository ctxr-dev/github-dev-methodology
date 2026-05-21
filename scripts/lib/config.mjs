// Read .agents/ctxr-dev/github-dev-methodology.config.local.md from the consumer project.
// Walks up from cwd looking for the .agents/ctxr-dev/ directory.
//
// Schema (per templates/config.local.md):
//   ## Active                  -> top-level keys including `active_project`
//   ## Project: <slug>         -> one section per tracked project, keys nested below
//   (further H3 subsections inside a project section are visual only; parser ignores them)
//
// readLocalConfig({ project }) returns the active project's flat key/value dict.
// Pass `project: "<slug>"` to override the file's `active_project` pointer.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export function findProjectRoot(start = process.cwd()) {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, ".agents", "ctxr-dev"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function configPath(root) {
  return join(root, ".agents", "ctxr-dev", "github-dev-methodology.config.local.md");
}

function parseSections(text) {
  // Returns { sectionName: { key: value } }. Top-level keys (before any H2) live under "__top__".
  // Only H2 headings (## ...) start a new section; H3+ stay inside the current section.
  const sections = { __top__: {} };
  let current = "__top__";
  for (const line of text.split("\n")) {
    const h2 = line.match(/^##\s+(?!#)(.+?)\s*$/);
    if (h2) {
      current = h2[1].trim();
      if (!sections[current]) sections[current] = {};
      continue;
    }
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/);
    if (row) {
      const key = row[1].trim();
      let val = row[2].trim();
      if (val.startsWith("<") && val.endsWith(">")) val = ""; // template placeholder
      sections[current][key] = val;
    }
  }
  return sections;
}

export function listProjects(projectRoot = null) {
  const root = projectRoot ?? findProjectRoot();
  if (!root) return [];
  const p = configPath(root);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  const slugs = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s+Project:\s+(.+?)\s*$/);
    if (m) slugs.push(m[1].trim());
  }
  return slugs;
}

export function readLocalConfig(opts = {}) {
  // Accept readLocalConfig() | readLocalConfig({ projectRoot, project }) | readLocalConfig("/path") for back-compat.
  const { projectRoot, project } = typeof opts === "string"
    ? { projectRoot: opts, project: null }
    : opts;
  const root = projectRoot ?? findProjectRoot();
  if (!root) return {};
  const p = configPath(root);
  if (!existsSync(p)) return {};
  const text = readFileSync(p, "utf8");
  const sections = parseSections(text);

  const top = { ...sections.__top__, ...(sections.Active ?? {}) };
  const slug = project ?? top.active_project ?? null;
  if (!slug) return {};
  // The slug template placeholder ("<slug>") renders as empty string after parseSections.
  if (slug === "" || slug === "<slug>") return {};

  const projectSection = sections[`Project: ${slug}`];
  if (!projectSection) return { _active_project: slug, _missing_project: true };
  return { ...projectSection, _active_project: slug };
}

export function parseProjectUrl(url) {
  // https://github.com/orgs/<OWNER>/projects/<NUM>/views/1
  const m = url.match(/github\.com\/orgs\/([^/]+)\/projects\/(\d+)/);
  if (!m) throw new Error(`unparseable project_url: ${url}`);
  return { owner: m[1], number: Number(m[2]) };
}

export function parseRepoSpec(spec) {
  // <OWNER>/<REPO> or full URL
  const repoUrl = spec.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (repoUrl) return { owner: repoUrl[1], repo: repoUrl[2] };
  const slash = spec.split("/");
  if (slash.length === 2) return { owner: slash[0], repo: slash[1] };
  throw new Error(`unparseable repo spec: ${spec}`);
}

export function parseIssueSpec(spec) {
  // <OWNER>/<REPO>#<NUM> or full URL
  const m = spec.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) };
  const url = spec.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  throw new Error(`unparseable issue spec: ${spec}`);
}
