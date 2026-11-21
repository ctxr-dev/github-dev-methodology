export const LEGACY_FEATURE_NAMES = Object.freeze([
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
]);

const MAPPED_HEADINGS = ["features", "project values", "reviewer + pr-loop config", "dev-loop modes", "plan-deprecation policy"];
const H2 = /^##\s+(?!#)(.+?)\s*$/;
const H3 = /^###\s+(?!#)(.+?)\s*$/;
const ROW = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|/;
const PROJECT_HEADING = /^Project:\s+(.+?)\s*$/;

export function parseBool(value) {
  if (value == null) return false;
  return ["true", "yes", "on", "1"].includes(String(value).trim().toLowerCase());
}

function cellValue(raw) {
  const value = raw.trim();
  return value.startsWith("<") && value.endsWith(">") ? "" : value;
}

function isMappedHeading(heading) {
  const lowered = heading.toLowerCase();
  return MAPPED_HEADINGS.some((known) => lowered.startsWith(known));
}

function newProject(slug) {
  return { slug, rows: {}, unmappedHeadings: [] };
}

export function parseLegacyConfig(text) {
  const active = {};
  const projects = [];
  const strayHeadings = [];
  let target = active;
  let project = null;
  for (const line of text.split("\n")) {
    const h2 = H2.exec(line);
    if (h2) {
      const title = h2[1].trim();
      const projectMatch = PROJECT_HEADING.exec(title);
      project = projectMatch ? newProject(projectMatch[1].trim()) : null;
      if (project) projects.push(project);
      else if (title !== "Active") strayHeadings.push(title);
      target = project ? project.rows : title === "Active" ? active : {};
      continue;
    }
    const h3 = project ? H3.exec(line) : null;
    if (h3 && !isMappedHeading(h3[1])) project.unmappedHeadings.push(h3[1].trim());
    const row = ROW.exec(line);
    if (row) target[row[1].trim()] = cellValue(row[2]);
  }
  return { activeProject: cellValue(active.active_project ?? ""), projects, strayHeadings };
}
