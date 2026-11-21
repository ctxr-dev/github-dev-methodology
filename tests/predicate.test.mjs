import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePredicate } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/predicate.mjs";
import { COPILOT_LOGIN, isBotLogin, normalizeLogin } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/logins.mjs";
import { HEAD, NOW, STALE, minutesAgo, projectWith, review, snapshot, thread } from "./fixtures/pr/pr-fakes.mjs";

const evaluate = (snap, review = {}) => evaluatePredicate(snap, projectWith(review), NOW);
const verdictOf = (result, login) => result.reviewers.find((reviewer) => reviewer.login === login).state;

test("a reviewer on head with no open threads is green and the PR is ready", () => {
  const result = evaluate(snapshot({ reviews: [review("alice")] }), { reviewers: ["alice"] });
  assert.equal(result.ready, true);
  assert.equal(verdictOf(result, "alice"), "green");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.headSha, HEAD);
  assert.equal(result.author, "author");
});

test("a review on a stale commit is pending, not green", () => {
  const result = evaluate(snapshot({ reviews: [review("alice", "APPROVED", STALE)] }), { reviewers: ["alice"] });
  assert.equal(result.ready, false);
  assert.equal(verdictOf(result, "alice"), "pending");
});

test("DISMISSED and PENDING reviews do not count", () => {
  for (const state of ["DISMISSED", "PENDING"]) {
    const result = evaluate(snapshot({ reviews: [review("alice", state)] }), { reviewers: ["alice"] });
    assert.equal(verdictOf(result, "alice"), "pending", state);
  }
});

test("CHANGES_REQUESTED on head is needs-work", () => {
  const result = evaluate(snapshot({ reviews: [review("alice", "CHANGES_REQUESTED")] }), { reviewers: ["alice"] });
  assert.equal(verdictOf(result, "alice"), "needs-work");
  assert.equal(result.ready, false);
});

test("an unresolved non-outdated thread first authored by the reviewer is needs-work", () => {
  const result = evaluate(snapshot({ reviews: [review("alice")], reviewThreads: [thread("alice")] }), { reviewers: ["alice"] });
  assert.equal(verdictOf(result, "alice"), "needs-work");
  assert.match(result.reasons[0], /1 unresolved thread/);
});

test("a thread authored by another reviewer is ignored", () => {
  const result = evaluate(snapshot({ reviews: [review("alice")], reviewThreads: [thread("bob")] }), { reviewers: ["alice"] });
  assert.equal(verdictOf(result, "alice"), "green");
  assert.equal(result.ready, true);
});

test("resolved and outdated threads are ignored", () => {
  const threads = [thread("alice", { isResolved: true }), thread("alice", { isOutdated: true })];
  const result = evaluate(snapshot({ reviews: [review("alice")], reviewThreads: threads }), { reviewers: ["alice"] });
  assert.equal(result.ready, true);
});

test("a required human who only commented blocks readiness; APPROVED unblocks it", () => {
  const settings = { reviewers: ["alice"], required_reviewers: ["alice"] };
  const commented = evaluate(snapshot({ reviews: [review("alice", "COMMENTED")] }), settings);
  assert.equal(commented.ready, false);
  assert.match(commented.reasons.join("\n"), /alice: approval required/);
  const approved = evaluate(snapshot({ reviews: [review("alice", "APPROVED")] }), settings);
  assert.equal(approved.ready, true);
});

test("a required reviewer outside review.reviewers is still evaluated", () => {
  const result = evaluate(snapshot(), { reviewers: [], required_reviewers: ["alice"] });
  assert.equal(result.ready, false);
  assert.equal(result.reviewers.length, 1);
});

test("a bot APPROVED is green but never satisfies required_reviewers", () => {
  const settings = { reviewers: ["copilot", "alice"], required_reviewers: ["alice"] };
  const botOnly = evaluate(snapshot({ reviews: [review(COPILOT_LOGIN, "APPROVED")] }), settings);
  assert.equal(verdictOf(botOnly, COPILOT_LOGIN), "green");
  assert.equal(botOnly.ready, false);
  const botRequired = evaluate(snapshot({ reviews: [review(COPILOT_LOGIN, "APPROVED")] }), { reviewers: ["copilot"], required_reviewers: ["copilot"] });
  assert.equal(botRequired.ready, false);
  assert.match(botRequired.reasons.join("\n"), /bot cannot approve/);
});

test("CI: null rollup means no CI gate; SUCCESS passes; anything else blocks", () => {
  assert.equal(evaluate(snapshot({ ci: null })).ready, true);
  assert.equal(evaluate(snapshot({ ci: "SUCCESS" })).ready, true);
  for (const ci of ["PENDING", "FAILURE", "ERROR", "EXPECTED"]) {
    const result = evaluate(snapshot({ ci }));
    assert.equal(result.ready, false, ci);
    assert.deepEqual(result.reasons, [`ci: ${ci}`]);
  }
});

test("CI-only mode: no reviewers configured, readiness follows CI alone", () => {
  assert.equal(evaluate(snapshot({ ci: "SUCCESS" }), { reviewers: [] }).ready, true);
  assert.equal(evaluate(snapshot({ ci: "PENDING" }), { reviewers: [] }).ready, false);
  assert.deepEqual(evaluate(snapshot(), { reviewers: [] }).reviewers, []);
});

test("a requested bot with no review past the timeout is skipped-timeout and non-blocking", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: minutesAgo(16), committedDate: null } });
  const result = evaluate(snap, { reviewers: ["copilot"] });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "skipped-timeout");
  assert.equal(result.ready, true);
});

test("a requested bot inside the timeout is still pending", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: minutesAgo(5), committedDate: null } });
  const result = evaluate(snap, { reviewers: ["copilot"] });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "pending");
  assert.equal(result.ready, false);
});

test("the timeout falls back to committedDate when pushedDate is null", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: null, committedDate: minutesAgo(30) } });
  assert.equal(verdictOf(evaluate(snap, { reviewers: ["copilot"] }), COPILOT_LOGIN), "skipped-timeout");
});

test("an unknown push time never times a bot out", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: null, committedDate: null } });
  assert.equal(verdictOf(evaluate(snap, { reviewers: ["copilot"] }), COPILOT_LOGIN), "pending");
});

test("the bot timeout follows bot_review_timeout_minutes", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: minutesAgo(16), committedDate: null } });
  const result = evaluate(snap, { reviewers: ["copilot"], bot_review_timeout_minutes: 30 });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "pending");
});

test("a bot absent from reviewRequests with no review on head is skipped-not-requested", () => {
  const result = evaluate(snapshot({ reviewRequests: [] }), { reviewers: ["copilot"] });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "skipped-not-requested");
  assert.equal(result.ready, true);
});

test("a bot that reviewed head is judged on its review even when not requested", () => {
  const snap = snapshot({ reviews: [review(COPILOT_LOGIN)], reviewThreads: [thread(COPILOT_LOGIN)] });
  const result = evaluate(snap, { reviewers: ["copilot"] });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "needs-work");
});

test("a human who has not reviewed stays pending even when not requested", () => {
  const result = evaluate(snapshot({ reviewRequests: [] }), { reviewers: ["alice"] });
  assert.equal(verdictOf(result, "alice"), "pending");
});

test("logins match case-insensitively and with or without [bot]", () => {
  const snap = snapshot({ reviews: [review("Copilot-Pull-Request-Reviewer[bot]"), review("ALICE")], reviewRequests: ["dependabot"] });
  const result = evaluate(snap, { reviewers: ["copilot", "alice", "dependabot[bot]"] });
  assert.equal(verdictOf(result, COPILOT_LOGIN), "green");
  assert.equal(verdictOf(result, "alice"), "green");
  assert.equal(verdictOf(result, "dependabot[bot]"), "skipped-timeout");
});

test("copilot and its canonical login are one reviewer", () => {
  const result = evaluate(snapshot({ reviewRequests: [COPILOT_LOGIN] }), { reviewers: ["copilot", COPILOT_LOGIN] });
  assert.equal(result.reviewers.length, 1);
  assert.equal(result.reviewers[0].login, COPILOT_LOGIN);
});

test("now may be a number or a clock function", () => {
  const snap = snapshot({ reviewRequests: [COPILOT_LOGIN], headCommit: { pushedDate: minutesAgo(20), committedDate: null } });
  const byFunction = evaluatePredicate(snap, projectWith({ reviewers: ["copilot"] }), () => NOW);
  assert.equal(verdictOf(byFunction, COPILOT_LOGIN), "skipped-timeout");
});

test("login helpers", () => {
  assert.equal(normalizeLogin("App/Dependabot"), "dependabot");
  assert.equal(normalizeLogin("copilot"), COPILOT_LOGIN);
  assert.equal(isBotLogin("renovate[bot]"), true);
  assert.equal(isBotLogin("copilot"), true);
  assert.equal(isBotLogin("alice"), false);
});
