import { canonicalReviewer, isBotLogin, normalizeLogin, sameLogin } from "./logins.mjs";

const MS_PER_MINUTE = 60_000;

function countUnresolvedByAuthor(threads) {
  const counts = new Map();
  for (const thread of threads) {
    if (thread.isResolved !== false || thread.isOutdated !== false) continue;
    const author = thread.comments?.nodes?.[0]?.author?.login;
    if (!author) continue;
    const key = normalizeLogin(author);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function pushedAtMs(headCommit) {
  const stamp = headCommit?.pushedDate ?? headCommit?.committedDate;
  return stamp ? Date.parse(stamp) : Number.NaN;
}

function botTimedOut(snapshot, timeoutMinutes, nowMs) {
  const pushedAt = pushedAtMs(snapshot.headCommit);
  return Number.isFinite(pushedAt) && nowMs - pushedAt >= timeoutMinutes * MS_PER_MINUTE;
}

function judgeReviewer(login, snapshot, facts) {
  const review = snapshot.reviews.find(
    (candidate) => sameLogin(candidate.author?.login, login) && candidate.state !== "DISMISSED" && candidate.state !== "PENDING",
  );
  const onHead = Boolean(review) && review.commit?.oid === snapshot.headRefOid;
  const unresolved = facts.unresolvedByAuthor.get(normalizeLogin(login)) ?? 0;
  const bot = isBotLogin(login);
  let verdict;
  if (onHead) {
    verdict = review.state === "CHANGES_REQUESTED" || unresolved > 0 ? "needs-work" : "green";
  } else if (bot && !facts.requested.has(normalizeLogin(login))) {
    verdict = "skipped-not-requested";
  } else if (bot && botTimedOut(snapshot, facts.timeoutMinutes, facts.nowMs)) {
    verdict = "skipped-timeout";
  } else {
    verdict = "pending";
  }
  return { login, bot, state: verdict, review: review?.state ?? null, onHead, unresolved };
}

function verdictReason(reviewer) {
  if (reviewer.state === "pending") return `${reviewer.login}: pending (no review on the current head yet)`;
  if (reviewer.state !== "needs-work") return null;
  const cause = reviewer.review === "CHANGES_REQUESTED" ? "changes requested" : `${reviewer.unresolved} unresolved thread(s)`;
  return `${reviewer.login}: needs-work (${cause})`;
}

function approvalReason(login, reviewers) {
  const reviewer = reviewers.find((candidate) => sameLogin(candidate.login, login));
  if (reviewer.bot) return `${login}: a bot cannot approve; remove it from review.required_reviewers`;
  if (reviewer.review === "APPROVED" && reviewer.onHead) return null;
  return `${login}: approval required on the current head (latest state: ${reviewer.review ?? "none"})`;
}

function uniqueLogins(logins) {
  const seen = new Map();
  for (const login of logins.map(canonicalReviewer)) {
    if (!seen.has(normalizeLogin(login))) seen.set(normalizeLogin(login), login);
  }
  return [...seen.values()];
}

function ciReason(ci) {
  return ci === null || ci === undefined || ci === "SUCCESS" ? null : `ci: ${ci}`;
}

export function evaluatePredicate(snapshot, project, now) {
  const { reviewers: configured, required_reviewers: required, bot_review_timeout_minutes: timeoutMinutes } = project.review;
  const facts = {
    unresolvedByAuthor: countUnresolvedByAuthor(snapshot.reviewThreads ?? []),
    requested: new Set((snapshot.reviewRequests ?? []).map(normalizeLogin)),
    timeoutMinutes,
    nowMs: typeof now === "function" ? now() : now,
  };
  const normalizedSnapshot = { ...snapshot, reviews: snapshot.reviews ?? [] };
  const reviewers = uniqueLogins([...configured, ...required]).map((login) => judgeReviewer(login, normalizedSnapshot, facts));
  const approvalReasons = uniqueLogins(required).map((login) => approvalReason(login, reviewers));
  const reasons = [
    ...reviewers.map(verdictReason),
    ...approvalReasons,
    ciReason(snapshot.ci),
  ].filter(Boolean);
  return {
    ready: reasons.length === 0,
    author: snapshot.author ?? null,
    headSha: snapshot.headRefOid,
    reviewers,
    ci: snapshot.ci ?? null,
    reasons,
  };
}
