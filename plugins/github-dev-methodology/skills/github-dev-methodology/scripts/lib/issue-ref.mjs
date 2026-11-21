import { UsageError } from "./errors.mjs";

const URL_FORM = /^https?:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)\/?$/;
const SHORT_FORM = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;

export function parseIssueRef(text) {
  const match = URL_FORM.exec(text ?? "") ?? SHORT_FORM.exec(text ?? "");
  if (!match) throw new UsageError(`expected an issue URL or owner/repo#N, got "${text ?? ""}"`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function parseRepoSlug(text) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(text ?? "");
  if (!match) throw new UsageError(`expected owner/repo, got "${text ?? ""}"`);
  return { owner: match[1], repo: match[2] };
}

export function issueKey({ owner, repo, number }) {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

export function refFromNode(node) {
  const [owner, repo] = node.repository.nameWithOwner.split("/");
  return { owner, repo, number: node.number };
}
