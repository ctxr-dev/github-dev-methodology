import { refLabel } from "./pr-state.mjs";

const SHORT_SHA_LENGTH = 7;

export function stateKey(evaluation) {
  const reviewers = evaluation.reviewers.map(({ login, state, review, unresolved }) => [login, state, review, unresolved]);
  return JSON.stringify({ ready: evaluation.ready, head: evaluation.headSha, ci: evaluation.ci, reviewers });
}

export function formatLine(ref, evaluation) {
  const status = evaluation.ready ? "ready" : "waiting";
  const reviewers = evaluation.reviewers.map((reviewer) => `${reviewer.login}=${reviewer.state}`).join(" ") || "no reviewers";
  const head = evaluation.headSha.slice(0, SHORT_SHA_LENGTH);
  const base = `${refLabel(ref)} ${status} head ${head} ci:${evaluation.ci ?? "none"} | ${reviewers}`;
  return evaluation.ready ? base : `${base} | ${evaluation.reasons.join("; ")}`;
}

export function jsonEntry(ref, evaluation, timestamp) {
  return {
    ts: timestamp,
    repo: `${ref.owner}/${ref.repo}`,
    number: ref.number,
    ready: evaluation.ready,
    headSha: evaluation.headSha,
    author: evaluation.author,
    ci: evaluation.ci,
    reviewers: evaluation.reviewers,
    reasons: evaluation.reasons,
  };
}

export function errorEntry(ref, message, timestamp) {
  return { ts: timestamp, repo: `${ref.owner}/${ref.repo}`, number: ref.number, error: message };
}
