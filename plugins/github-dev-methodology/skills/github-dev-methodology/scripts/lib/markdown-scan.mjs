import { classifyLines } from "./markdown-fences.mjs";

const INLINE_CODE = /`+([^`]+)`+/g;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function codeSegments(text) {
  const segments = [];
  for (const { line, inFence } of classifyLines(text)) {
    if (inFence) segments.push(line);
    else segments.push(...[...line.matchAll(INLINE_CODE)].map((match) => match[1]));
  }
  return segments;
}

export function linkTargets(text) {
  const targets = [];
  for (const { line, inFence } of classifyLines(text)) {
    if (inFence) continue;
    for (const match of line.replace(INLINE_CODE, "").matchAll(LINK)) targets.push(match[1]);
  }
  return targets;
}
