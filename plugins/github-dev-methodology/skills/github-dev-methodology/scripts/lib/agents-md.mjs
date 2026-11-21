import { GdmError } from "./errors.mjs";

export const BLOCK_START = "<!-- gdm:start -->";
export const BLOCK_END = "<!-- gdm:end -->";
const SECTION_HEADING = /^## Methodologies\s*$/;
const HEADING_AT_SECTION_LEVEL = /^#{1,2}\s/;
const FENCE = /^\s*(```|~~~)/;

export function renderBlock(blockText) {
  return `${BLOCK_START}\n${blockText.trim()}\n${BLOCK_END}`;
}

export function hasBlock(text) {
  return text.includes(BLOCK_START) && text.includes(BLOCK_END);
}

function methodologiesSection(lines) {
  let inFence = false;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || FENCE.test(line)) continue;
    if (start === -1 && SECTION_HEADING.test(line)) start = index;
    else if (start !== -1 && HEADING_AT_SECTION_LEVEL.test(line)) return { start, end: index };
  }
  return start === -1 ? null : { start, end: lines.length };
}

function lastContentLine(lines, start, end) {
  let last = end - 1;
  while (last > start && lines[last].trim() === "") last -= 1;
  return last;
}

function insertIntoSection(text, block) {
  const lines = text.split("\n");
  const { start, end } = methodologiesSection(lines);
  const last = lastContentLine(lines, start, end);
  const inserted = ["", ...block.split("\n")];
  const tail = lines.slice(end);
  const separator = tail.length > 0 ? [""] : [];
  return [...lines.slice(0, last + 1), ...inserted, ...separator, ...tail].join("\n").replace(/\n*$/, "\n");
}

function replaceBetweenMarkers(text, block) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END, start);
  if (start === -1 || end === -1) throw new GdmError("AGENTS.md has an unpaired gdm marker; fix or remove it and run gdm init again");
  return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
}

export function ensureMethodologyBlock(existing, blockText) {
  const block = renderBlock(blockText);
  if (existing === null || existing.trim() === "") {
    return `# AGENTS.md\n\n## Methodologies\n\n${block}\n`;
  }
  if (existing.includes(BLOCK_START) || existing.includes(BLOCK_END)) return replaceBetweenMarkers(existing, block);
  if (methodologiesSection(existing.split("\n"))) return insertIntoSection(existing, block);
  return `${existing.replace(/\n*$/, "")}\n\n## Methodologies\n\n${block}\n`;
}
