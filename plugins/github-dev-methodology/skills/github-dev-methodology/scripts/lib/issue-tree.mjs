import { fetchWithBlockers, fetchWithChildren } from "./issue-fetch.mjs";

export const MAX_DEPTH = 4;

const label = (summary) => `${summary.ref.owner}/${summary.ref.repo}#${summary.ref.number}`;

export async function walkDown(gh, rootRef) {
  const defects = [];
  const seen = new Set();
  let total = 0;
  let maxDepth = 0;

  async function visit(ref, depth, path) {
    const issue = await fetchWithChildren(gh, ref);
    seen.add(issue.key);
    total += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (depth > MAX_DEPTH) {
      defects.push({ kind: "too-deep", issue: label(issue), detail: `depth ${depth} exceeds ${MAX_DEPTH}` });
    }
    const onPath = [...path, issue.key];
    for (const child of issue.children) {
      recordChildDefects(child, issue, onPath);
      if (onPath.includes(child.key) || seen.has(child.key)) continue;
      await visit(child.ref, depth + 1, onPath);
    }
  }

  function recordChildDefects(child, parent, path) {
    if (path.includes(child.key)) {
      defects.push({ kind: "cycle", issue: label(child), detail: [...path, child.key].join(" -> ") });
      return;
    }
    if (seen.has(child.key)) {
      defects.push({ kind: "asymmetric", issue: label(child), detail: `listed again under ${label(parent)}` });
      return;
    }
    if (child.parent === null) {
      defects.push({ kind: "orphan", issue: label(child), detail: `listed under ${label(parent)} but has no parent` });
    } else if (child.parent !== parent.key) {
      defects.push({
        kind: "asymmetric",
        issue: label(child),
        detail: `listed under ${label(parent)} but its parent is ${label({ ref: child.parentRef })}`,
      });
    }
  }

  await visit(rootRef, 0, []);
  return { defects, total, maxDepth };
}

export async function walkUp(gh, startRef) {
  const chain = [];
  const blockers = [];
  const defects = [];
  const visited = new Set();
  let ref = startRef;
  while (ref) {
    const issue = await fetchWithBlockers(gh, ref);
    if (visited.has(issue.key)) {
      defects.push({ kind: "cycle", issue: label(issue), detail: `parent chain loops back to ${label(issue)}` });
      break;
    }
    visited.add(issue.key);
    chain.push({ issue: label(issue), title: issue.title, state: issue.state });
    for (const blocker of issue.blockers.filter((candidate) => candidate.state === "OPEN")) {
      blockers.push({ issue: label(issue), blockedBy: label(blocker), title: blocker.title });
    }
    ref = issue.parentRef;
  }
  return { chain, blockers, defects };
}
