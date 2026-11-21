import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run as canMerge } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/pr-can-merge.mjs";
import { run as requestReviews } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/pr-request-reviews.mjs";
import { run as threads } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/pr-threads.mjs";
import { COPILOT_LOGIN } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/logins.mjs";
import { capture, fakeClock, fakeGhRunner, repoWith, review, snapshotResponse, threadsPageResponse } from "./fixtures/pr/pr-fakes.mjs";

const ALICE_WAITING = { reviews: [] };

function context(root, gh, extra = {}) {
  const clock = fakeClock();
  return { cwd: root, gh, now: clock.now, sleep: clock.sleep, clock, json: false, ...capture(), ...extra };
}

function scriptedSnapshots(steps) {
  return fakeGhRunner((query, variables, index) => snapshotResponse(steps[Math.min(index, steps.length - 1)]));
}

function requestHandler({ requested = [], suggested = [], users = {} } = {}) {
  let mutated = false;
  return (query, variables) => {
    if (query.includes("requestReviews")) {
      mutated = true;
      return { requestReviews: { pullRequest: { id: "PR_1" } } };
    }
    if (query.includes("suggestedActors")) return { repository: { suggestedActors: { nodes: suggested } } };
    if (query.includes("user(login")) {
      return Object.fromEntries(Object.entries(variables).map(([key, login], index) => [`u${index}`, users[login] ? { id: users[login], login } : null]));
    }
    const nodes = (mutated ? requested : []).map((login) => ({ requestedReviewer: { login } }));
    return { repository: { pullRequest: { id: "PR_1", reviewRequests: { nodes } } } };
  };
}

test("request-reviews discovers the Copilot bot id, requests it and writes it back", async () => {
  const { root, configPath } = repoWith({ review: { reviewers: ["copilot", "alice"] } });
  const { gh, calls } = fakeGhRunner(
    requestHandler({
      requested: [COPILOT_LOGIN, "alice"],
      suggested: [{ id: "BOT_9", login: COPILOT_LOGIN }, { id: "U_1", login: "alice" }],
      users: { alice: "U_1" },
    }),
  );
  const ctx = context(root, gh);
  assert.equal(await requestReviews(["o/r#3"], ctx), 0);
  const mutation = calls.find((call) => call.query.includes("requestReviews(input"));
  assert.deepEqual(mutation.variables, { pr: "PR_1", userIds: ["U_1"], botIds: ["BOT_9"] });
  const raw = readFileSync(configPath, "utf8");
  assert.equal(JSON.parse(raw).projects["my-project"].cache.copilot_bot_id, "BOT_9");
  assert.equal(raw, `${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
  assert.match(ctx.out.join(""), /requested: copilot-pull-request-reviewer, alice/);
});

test("request-reviews uses the cached Copilot bot id without discovery", async () => {
  const { root } = repoWith({ review: { reviewers: ["copilot"] }, cache: { copilot_bot_id: "BOT_CACHED" } });
  const { gh, calls } = fakeGhRunner(requestHandler({ requested: [COPILOT_LOGIN] }));
  assert.equal(await requestReviews(["o/r#3"], context(root, gh)), 0);
  assert.equal(calls.some((call) => call.query.includes("suggestedActors")), false);
  assert.deepEqual(calls.find((call) => call.query.includes("requestReviews(input")).variables.botIds, ["BOT_CACHED"]);
});

test("request-reviews reports request-ignored and exits 1 when a login is missing after the request", async () => {
  const { root } = repoWith({ review: { reviewers: ["copilot", "alice"] }, cache: { copilot_bot_id: "BOT_CACHED" } });
  const { gh } = fakeGhRunner(requestHandler({ requested: ["alice"], users: { alice: "U_1" } }));
  const ctx = context(root, gh);
  assert.equal(await requestReviews(["o/r#3"], ctx), 1);
  assert.equal(ctx.err.join(""), `request-ignored: ${COPILOT_LOGIN}\n`);
});

test("request-reviews flags a bot it cannot discover", async () => {
  const { root } = repoWith({ review: { reviewers: ["copilot"] } });
  const { gh, calls } = fakeGhRunner(requestHandler({ suggested: [] }));
  const ctx = context(root, gh);
  assert.equal(await requestReviews(["o/r#3"], ctx), 1);
  assert.equal(calls.some((call) => call.query.includes("requestReviews(input")), false);
  assert.match(ctx.err.join(""), /request-ignored: copilot-pull-request-reviewer/);
});

test("request-reviews with no reviewers configured does nothing and exits 0", async () => {
  const { root } = repoWith();
  const { gh, calls } = fakeGhRunner(requestHandler());
  const ctx = context(root, gh);
  assert.equal(await requestReviews(["o/r#3"], ctx), 0);
  assert.equal(calls.some((call) => call.query.includes("requestReviews(input")), false);
  assert.match(ctx.out.join(""), /CI-only/);
});

function threadNode(id, login, overrides = {}) {
  return { id, isResolved: false, isOutdated: false, path: "a.js", line: 4, comments: { nodes: [{ author: { login }, body: `fix ${id}`, url: `u/${id}` }] }, ...overrides };
}

function threadsHandler() {
  return (query, variables) => {
    if (query.includes("resolveReviewThread")) {
      if (variables.id === "T_BAD") throw new Error("cannot resolve");
      return { resolveReviewThread: { thread: { id: variables.id, isResolved: true } } };
    }
    return variables.cursor === null
      ? threadsPageResponse([threadNode("T1", "alice"), threadNode("T2", "bob"), threadNode("T3", "alice", { isResolved: true })], "next")
      : threadsPageResponse([threadNode("T4", "Alice"), threadNode("T5", "alice", { isOutdated: true })]);
  };
}

test("threads lists unresolved non-outdated threads across pages", async () => {
  const { root } = repoWith();
  const { gh, calls } = fakeGhRunner(threadsHandler());
  const ctx = context(root, gh);
  assert.equal(await threads(["o/r#1"], ctx), 0);
  assert.equal(calls.length, 2);
  const lines = ctx.out.join("").trim().split("\n");
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), ["T1", "T2", "T4"]);
  assert.match(lines[0], /^T1 a\.js:4 @alice: fix T1$/);
});

test("threads --author filters case-insensitively and --json prints structured output", async () => {
  const { root } = repoWith();
  const { gh } = fakeGhRunner(threadsHandler());
  const ctx = context(root, gh, { json: true });
  assert.equal(await threads(["o/r#1", "--author", "alice", "--json"], ctx), 0);
  const parsed = JSON.parse(ctx.out.join(""));
  assert.deepEqual(parsed.map((item) => item.id), ["T1", "T4"]);
  assert.deepEqual(Object.keys(parsed[0]), ["id", "path", "line", "author", "body", "url"]);
});

test("threads --resolve resolves every id and exits 1 if one fails", async () => {
  const { root } = repoWith();
  const { gh, calls } = fakeGhRunner(threadsHandler());
  const ctx = context(root, gh);
  assert.equal(await threads(["o/r#1", "--resolve", "T1", "T_BAD", "T2"], ctx), 1);
  assert.deepEqual(calls.map((call) => call.variables.id), ["T1", "T_BAD", "T2"]);
  assert.equal(ctx.out.join(""), "resolved: T1\nresolved: T2\n");
  assert.match(ctx.err.join(""), /resolve-failed: T_BAD/);
});

test("threads --resolve with all ids succeeding exits 0", async () => {
  const { root } = repoWith();
  const { gh } = fakeGhRunner(threadsHandler());
  assert.equal(await threads(["o/r#1", "--resolve", "T1"], context(root, gh)), 0);
});

test("can-merge with authority human exits 4 without calling gh", async () => {
  const { root } = repoWith();
  const { gh, calls } = fakeGhRunner(() => assert.fail("gh must not be called"));
  const ctx = context(root, gh);
  assert.equal(await canMerge(["o/r#1"], ctx), 4);
  assert.equal(calls.length, 0);
  assert.match(ctx.out.join(""), /^deny: merge.authority is human/);
});

test("can-merge autonomous: ready allows (0), not ready denies (3) with the blockers", async () => {
  const { root } = repoWith({ merge: { authority: "autonomous" }, review: { reviewers: ["alice"] } });
  const ready = context(root, scriptedSnapshots([{ reviews: [review("alice")] }]).gh);
  assert.equal(await canMerge(["o/r#1"], ready), 0);
  assert.match(ready.out.join(""), /^allow:/);
  const waiting = context(root, scriptedSnapshots([ALICE_WAITING]).gh);
  assert.equal(await canMerge(["o/r#1"], waiting), 3);
  assert.match(waiting.out.join(""), /^deny: .*not ready[\s\S]*alice: pending/);
});

test("can-merge scoped: dependency bot author allows, session-instruction asks (4)", async () => {
  const bot = repoWith({ merge: { authority: "scoped", scopes: ["dependabot-green"] } });
  const botCtx = context(bot.root, scriptedSnapshots([{ author: "dependabot" }]).gh);
  assert.equal(await canMerge(["o/r#1"], botCtx), 0);
  const instructed = repoWith({ merge: { authority: "scoped", scopes: ["session-instruction"] } });
  const instructedCtx = context(instructed.root, scriptedSnapshots([{ author: "alice" }]).gh);
  assert.equal(await canMerge(["o/r#1"], instructedCtx), 4);
  assert.equal(instructedCtx.out.join(""), "ask: needs explicit owner instruction in this session\n");
});

test("can-merge --json prints the decision", async () => {
  const { root } = repoWith();
  const ctx = context(root, fakeGhRunner(() => ({})).gh, { json: true });
  assert.equal(await canMerge(["o/r#1", "--json"], ctx), 4);
  const parsed = JSON.parse(ctx.out.join(""));
  assert.equal(parsed.decision, "deny");
  assert.equal(parsed.exitCode, 4);
  assert.equal(parsed.authority, "human");
});

test("bare PR numbers resolve against the project org and primary repo", async () => {
  const { root } = repoWith({ merge: { authority: "autonomous" } });
  const { gh, calls } = scriptedSnapshots([{}]);
  await canMerge(["12"], context(root, gh));
  assert.deepEqual([calls[0].variables.o, calls[0].variables.r, calls[0].variables.n], ["my-org", "my-repo", 12]);
});
