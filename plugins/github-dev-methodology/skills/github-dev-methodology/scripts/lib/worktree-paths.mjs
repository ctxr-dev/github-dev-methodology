import { readdirSync, realpathSync, rmdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { expandHome } from "./paths.mjs";

export function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isInside(path, parent) {
  const child = canonicalPath(path);
  const base = canonicalPath(parent);
  return child === base || child.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function clientManagedRoots(repoRoot, env) {
  return [join(repoRoot, ".claude", "worktrees"), expandHome("~/.codex/worktrees", env), expandHome("~/.omp/wt", env)];
}

export function isClientManaged(path, repoRoot, env) {
  return clientManagedRoots(repoRoot, env).some((root) => isInside(path, root));
}

export function removeEmptyParents(removedPath, stopAt) {
  const base = canonicalPath(stopAt);
  let dir = canonicalPath(dirname(removedPath));
  while (dir.startsWith(base + sep)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}
