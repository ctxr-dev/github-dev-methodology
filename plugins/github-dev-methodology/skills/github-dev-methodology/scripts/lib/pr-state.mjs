import { GhError, UsageError } from "./errors.mjs";
import { evaluatePredicate } from "./predicate.mjs";
import { SNAPSHOT_QUERY, THREADS_PAGE_QUERY } from "./pr-queries.mjs";

const REF_SHORT = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;
const REF_URL = /^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const REF_BARE = /^#?(\d+)$/;

export function parsePrRef(text, defaults = {}) {
  const value = String(text ?? "").trim();
  const full = REF_SHORT.exec(value) ?? REF_URL.exec(value);
  if (full) return { owner: full[1], repo: full[2], number: Number(full[3]) };
  const bare = REF_BARE.exec(value);
  if (bare && defaults.owner && defaults.repo) {
    return { owner: defaults.owner, repo: defaults.repo, number: Number(bare[1]) };
  }
  if (bare) throw new UsageError(`cannot resolve PR "${value}" without a default repo; use owner/repo#N`);
  throw new UsageError(`unparseable PR reference: "${value}" (want owner/repo#N, a PR URL, or a number)`);
}

export function refLabel(ref) {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

function requestedLogins(nodes) {
  return nodes.map((node) => node.requestedReviewer?.login ?? node.requestedReviewer?.slug).filter(Boolean);
}

async function collectThreads(gh, ref, firstPage) {
  const threads = [...firstPage.nodes];
  let page = firstPage.pageInfo;
  while (page?.hasNextPage) {
    const data = await gh.graphql(THREADS_PAGE_QUERY, { o: ref.owner, r: ref.repo, n: ref.number, c: page.endCursor });
    const connection = data.repository.pullRequest.reviewThreads;
    threads.push(...connection.nodes);
    page = connection.pageInfo;
  }
  return threads;
}

export async function fetchSnapshot(gh, ref) {
  const data = await gh.graphql(SNAPSHOT_QUERY, { o: ref.owner, r: ref.repo, n: ref.number, c: null });
  const pr = data?.repository?.pullRequest;
  if (!pr) throw new GhError(`PR not found: ${refLabel(ref)}`);
  const headCommit = pr.commits.nodes[0]?.commit ?? {};
  return {
    headRefOid: pr.headRefOid,
    headCommit: { pushedDate: headCommit.pushedDate ?? null, committedDate: headCommit.committedDate ?? null },
    author: pr.author?.login ?? null,
    reviews: pr.latestReviews.nodes,
    reviewRequests: requestedLogins(pr.reviewRequests.nodes),
    reviewThreads: await collectThreads(gh, ref, pr.reviewThreads),
    ci: headCommit.statusCheckRollup?.state ?? null,
  };
}

export async function evaluatePr(gh, ref, project, now) {
  const snapshot = await fetchSnapshot(gh, ref);
  return evaluatePredicate(snapshot, project, now);
}
