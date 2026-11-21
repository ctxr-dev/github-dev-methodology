import { spawnSync } from "node:child_process";
import { NoOriginError, NotGitRepoError, UnsupportedRemoteError } from "./errors.mjs";

export function spawnGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const SCP_LIKE_REMOTE = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/;

function splitHostAndPath(remoteUrl) {
  if (remoteUrl.includes("://")) {
    const url = new URL(remoteUrl);
    return { host: url.hostname, path: url.pathname };
  }
  const match = SCP_LIKE_REMOTE.exec(remoteUrl);
  if (!match) return null;
  return { host: match[1], path: match[2] };
}

export function parseRemoteUrl(remoteUrl) {
  const trimmed = remoteUrl.trim();
  let parts = null;
  try {
    parts = splitHostAndPath(trimmed);
  } catch {
    parts = null;
  }
  const segments = parts?.path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
  if (!parts || segments.length !== 2 || segments.some((segment) => segment === "")) {
    throw new UnsupportedRemoteError(`unsupported origin remote URL: ${trimmed}`);
  }
  return { host: parts.host.toLowerCase(), owner: segments[0], repo: segments[1] };
}

export function repoRoot(cwd, git = spawnGit) {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  if (result.status !== 0) throw new NotGitRepoError(`not a git repository: ${cwd}`);
  return result.stdout.trim();
}

export function repoIdentity(cwd, git = spawnGit) {
  const root = repoRoot(cwd, git);
  const remote = git(["remote", "get-url", "origin"], root);
  if (remote.status !== 0 || remote.stdout.trim() === "") throw new NoOriginError();
  return { root, ...parseRemoteUrl(remote.stdout) };
}
