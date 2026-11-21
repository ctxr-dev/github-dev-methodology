import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGh } from "../../../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";

const template = JSON.parse(readFileSync(new URL("../../../plugins/github-dev-methodology/skills/github-dev-methodology/assets/config.template.json", import.meta.url), "utf8"));

export const HEAD = "a".repeat(40);
export const STALE = "b".repeat(40);
export const NOW = Date.parse("2026-01-01T12:00:00Z");
export const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

export function reviewSettings(overrides = {}) {
  return {
    reviewers: [],
    required_reviewers: [],
    bot_review_timeout_minutes: 15,
    poll_seconds: 60,
    max_hours: 24,
    wait_mode: "foreground",
    ...overrides,
  };
}

export function projectWith(review = {}) {
  return { review: reviewSettings(review) };
}

export function snapshot(overrides = {}) {
  return {
    headRefOid: HEAD,
    headCommit: { pushedDate: minutesAgo(60), committedDate: minutesAgo(61) },
    author: "author",
    reviews: [],
    reviewRequests: [],
    reviewThreads: [],
    ci: "SUCCESS",
    ...overrides,
  };
}

export const review = (login, state = "COMMENTED", oid = HEAD) => ({ author: { login }, state, commit: { oid } });

export const thread = (login, { isResolved = false, isOutdated = false } = {}) => ({
  isResolved,
  isOutdated,
  comments: { nodes: [{ author: { login } }] },
});

export function snapshotResponse(options = {}) {
  const { head = HEAD, author = "author", reviews = [], requests = [], threads = [], ci = "SUCCESS", pushedDate = minutesAgo(60), threadPages } = options;
  const pages = threadPages ?? [threads];
  return {
    repository: {
      pullRequest: {
        headRefOid: head,
        author: { login: author },
        latestReviews: { nodes: reviews },
        reviewRequests: { nodes: requests.map((login) => ({ requestedReviewer: { login } })) },
        commits: { nodes: [{ commit: { pushedDate, committedDate: pushedDate, statusCheckRollup: ci ? { state: ci } : null } }] },
        reviewThreads: { pageInfo: { hasNextPage: pages.length > 1, endCursor: pages.length > 1 ? "page-2" : null }, nodes: pages[0] },
      },
    },
  };
}

export function threadsPageResponse(nodes, nextCursor = null) {
  return { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: Boolean(nextCursor), endCursor: nextCursor }, nodes } } } };
}

export function fakeGhRunner(handler) {
  const calls = [];
  const runner = (args, options) => {
    const { query, variables } = JSON.parse(options.input);
    calls.push({ query, variables });
    try {
      return { status: 0, stdout: JSON.stringify({ data: handler(query, variables, calls.length - 1) }), stderr: "" };
    } catch (error) {
      return { status: 1, stdout: "", stderr: error.message };
    }
  };
  return { gh: createGh(runner), calls };
}

export function fakeClock(startMs = NOW) {
  let current = startMs;
  const sleeps = [];
  return {
    now: () => current,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      current += milliseconds;
    },
    sleeps,
  };
}

export function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, out, err };
}

export function repoWith(projectOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "gdm-pr-"));
  const dir = join(root, ".github-dev-methodology");
  mkdirSync(dir);
  const config = JSON.parse(JSON.stringify(template));
  const project = config.projects["my-project"];
  for (const [key, value] of Object.entries(projectOverrides)) {
    project[key] = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...project[key], ...value } : value;
  }
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return { root, configPath: join(dir, "config.json") };
}
