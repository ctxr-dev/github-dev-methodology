import { classifyLines } from "./markdown-fences.mjs";

export const REGULAR_SECTIONS = ["Why", "Action items", "Acceptance", "Implementation pointers", "Test plan"];
export const EPIC_SECTIONS = ["Mission", "Children", "Decision log"];

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

export function readSections(body) {
  const sections = new Map();
  let current = null;
  for (const { line, inFence } of classifyLines(body ?? "")) {
    const heading = inFence ? null : HEADING.exec(line);
    if (heading && heading[1].length <= 2) {
      current = heading[1].length === 2 ? { lines: [] } : null;
      if (current) sections.set(heading[2].trim().toLowerCase(), current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

export function missingSections(body, required) {
  const sections = readSections(body);
  return required.filter((name) => {
    const section = sections.get(name.toLowerCase());
    return !section || section.lines.join("\n").replace(HTML_COMMENT, "").trim() === "";
  });
}

export function isEpic(issue) {
  if (issue.issueType?.name === "Epic") return true;
  return (issue.labels?.nodes ?? []).some((candidate) => candidate.name === "type:epic");
}
