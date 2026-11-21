import { loadRepoConfig } from "./config.mjs";
import { ConfigMissingError, GhError, NoOriginError } from "./errors.mjs";
import { matchMerge } from "./merge-patterns.mjs";
import { repoIdentity, spawnGit } from "./repo-identity.mjs";

async function loadPrModules(deps) {
  const prState = deps.evaluatePr && deps.parsePrRef ? null : await import("./pr-state.mjs");
  const mergeAuthority = deps.decideMerge ? null : await import("./merge-authority.mjs");
  return {
    evaluatePr: deps.evaluatePr ?? prState.evaluatePr,
    parsePrRef: deps.parsePrRef ?? prState.parsePrRef,
    decideMerge: deps.decideMerge ?? mergeAuthority.decideMerge,
  };
}

function defaultRepo(cwd, project, git) {
  try {
    const { owner, repo } = repoIdentity(cwd, git);
    return { owner, repo };
  } catch (error) {
    if (error instanceof NoOriginError) return { owner: project.org, repo: project.primary_repo };
    throw error;
  }
}

async function currentBranchPr({ gh, git, cwd, defaults, parsePrRef }) {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = head.stdout.trim();
  if (head.status !== 0 || branch === "" || branch === "HEAD") {
    throw new Error("cannot resolve the pull request: no branch checked out and no PR argument");
  }
  const view = await gh.cli(["pr", "view", branch, "--repo", `${defaults.owner}/${defaults.repo}`, "--json", "number,url"]);
  if (view.status !== 0) throw new GhError(view.stderr.trim() || "gh pr view failed", view);
  return parsePrRef(JSON.parse(view.stdout).url, defaults);
}

export async function checkMerge({ command, cwd, gh, git = spawnGit, now = Date.now, ...deps }) {
  const { matched, prArg } = matchMerge(command);
  if (!matched) return null;
  let loaded;
  try {
    loaded = loadRepoConfig(cwd, { git });
  } catch (error) {
    if (error instanceof ConfigMissingError) return null;
    throw error;
  }
  const { authority, scopes } = loaded.project.merge;
  const { evaluatePr, parsePrRef, decideMerge } = await loadPrModules(deps);
  if (authority === "human") return decideMerge({ authority, scopes, predicateReady: false, prAuthor: null });
  const defaults = defaultRepo(cwd, loaded.project, git);
  const ref = prArg ? parsePrRef(prArg, defaults) : await currentBranchPr({ gh, git, cwd, defaults, parsePrRef });
  const state = await evaluatePr(gh, ref, loaded.project, now);
  return decideMerge({ authority, scopes, predicateReady: state.ready, prAuthor: state.author });
}
