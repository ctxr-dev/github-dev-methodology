import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "./errors.mjs";
import { gdmHome, statePath } from "./paths.mjs";
import { canonicalPath, removeEmptyParents } from "./worktree-paths.mjs";

export const GDM_LOCK_PREFIX = "gdm:";
const LOCK_DETAILS = /^gdm: owner=(.*) created=(\S+)$/;

export function defaultOwner() {
  return `${hostname()}:${process.ppid}`;
}

export function normalizeOwner(owner) {
  const cleaned = owner.replace(/\s+/g, " ").trim();
  if (cleaned === "") throw new UsageError("--owner needs a non-empty value");
  return cleaned;
}

export function ownerRecordPath(id, env, branch) {
  const segments = branch.split("/");
  const name = `${segments.pop()}.json`;
  return statePath(id, env, "worktrees", ...segments, name);
}

export function writeOwnerRecord({ id, env, branch, path, owner, createdAt }) {
  const file = ownerRecordPath(id, env, branch);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ branch, path, owner, created_at: createdAt }, null, 2)}\n`);
}

export function readOwnerRecord(id, env, entry) {
  if (!entry.branch) return null;
  try {
    const record = JSON.parse(readFileSync(ownerRecordPath(id, env, entry.branch), "utf8"));
    return canonicalPath(record.path) === canonicalPath(entry.path) ? record : null;
  } catch {
    return null;
  }
}

export function deleteOwnerRecord(id, env, branch) {
  const file = ownerRecordPath(id, env, branch);
  rmSync(file, { force: true });
  removeEmptyParents(file, join(gdmHome(env), "state"));
}

export function lockReason(owner, createdAt) {
  return `${GDM_LOCK_PREFIX} owner=${owner} created=${createdAt}`;
}

export function isGdmLock(reason) {
  return typeof reason === "string" && reason.startsWith(GDM_LOCK_PREFIX);
}

export function describeLock(reason, now) {
  const match = typeof reason === "string" ? LOCK_DETAILS.exec(reason) : null;
  if (!match) return { owner: null, ageSeconds: null };
  const created = Date.parse(match[2]);
  const ageSeconds = Number.isNaN(created) ? null : Math.max(0, Math.floor((now() - created) / 1000));
  return { owner: match[1], ageSeconds };
}

export function lockWorktree(git, root, path, owner, createdAt) {
  const result = git(["worktree", "lock", "--reason", lockReason(owner, createdAt), path], root);
  if (result.status === 0) return null;
  return `warn: could not lock ${path}: ${(result.stderr || result.stdout).trim()}`;
}

export function claimWorktree({ git, id, env, branch, path, owner, now }) {
  const createdAt = new Date(now()).toISOString();
  writeOwnerRecord({ id, env, branch, path, owner, createdAt });
  return lockWorktree(git, id.root, path, owner, createdAt);
}
