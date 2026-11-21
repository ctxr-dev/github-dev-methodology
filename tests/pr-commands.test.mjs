import assert from "node:assert/strict";
import { test } from "node:test";
import { run as watch } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/pr-watch.mjs";
import { UsageError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { evaluatePr, parsePrRef } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/pr-state.mjs";
import { HEAD, NOW, capture, fakeClock, fakeGhRunner, projectWith, repoWith, review, snapshotResponse, thread, threadsPageResponse } from "./fixtures/pr/pr-fakes.mjs";

const ALICE_READY = { reviews: [review("alice", "APPROVED")] };
const ALICE_WAITING = { reviews: [] };
const watchConfig = { review: { reviewers: ["alice"], required_reviewers: ["alice"], poll_seconds: 60, max_hours: 1 } };

function context(root, gh, extra = {}) {
  const clock = fakeClock();
  return { cwd: root, gh, now: clock.now, sleep: clock.sleep, clock, json: false, ...capture(), ...extra };
}

function scriptedSnapshots(steps) {
  return fakeGhRunner((query, variables, index) => {
    const step = steps[Math.min(index, steps.length - 1)];
    if (step instanceof Error) throw step;
    return snapshotResponse(step);
  });
}

test("parsePrRef accepts owner/repo#N, a PR URL and a bare number", () => {
  const defaults = { owner: "o", repo: "r" };
  assert.deepEqual(parsePrRef("a/b#7", defaults), { owner: "a", repo: "b", number: 7 });
  assert.deepEqual(parsePrRef("https://github.com/a/b/pull/8", defaults), { owner: "a", repo: "b", number: 8 });
  assert.deepEqual(parsePrRef("https://github.com/a/b/pull/8/files", defaults), { owner: "a", repo: "b", number: 8 });
  assert.deepEqual(parsePrRef("9", defaults), { owner: "o", repo: "r", number: 9 });
  assert.deepEqual(parsePrRef("#9", defaults), { owner: "o", repo: "r", number: 9 });
  assert.throws(() => parsePrRef("9", {}), UsageError);
  assert.throws(() => parsePrRef("nonsense", defaults), UsageError);
});

test("evaluatePr reads thread pages beyond the first", async () => {
  const pages = [[thread("bob")], [thread("alice")]];
  const { gh, calls } = fakeGhRunner((query) =>
    query.includes("latestReviews") ? snapshotResponse({ ...ALICE_READY, threadPages: pages }) : threadsPageResponse(pages[1]),
  );
  const result = await evaluatePr(gh, { owner: "o", repo: "r", number: 1 }, projectWith({ reviewers: ["alice"] }), NOW);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].variables.c, "page-2");
  assert.equal(result.ready, false);
  assert.match(result.reasons[0], /alice: needs-work/);
});

test("evaluatePr throws when the PR does not exist", async () => {
  const { gh } = fakeGhRunner(() => ({ repository: { pullRequest: null } }));
  await assert.rejects(evaluatePr(gh, { owner: "o", repo: "r", number: 1 }, projectWith(), NOW), /PR not found: o\/r#1/);
});

test("watch exits 0 on a ready PR and prints one line", async () => {
  const { root } = repoWith(watchConfig);
  const { gh } = scriptedSnapshots([ALICE_READY]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 0);
  assert.equal(ctx.out.length, 1);
  assert.match(ctx.out[0], /^o\/r#1 ready head aaaaaaa ci:SUCCESS \| alice=green\n$/);
  assert.deepEqual(ctx.clock.sleeps, []);
});

test("watch prints only state changes and exits 0 once ready", async () => {
  const { root } = repoWith(watchConfig);
  const { gh, calls } = scriptedSnapshots([ALICE_WAITING, ALICE_WAITING, ALICE_WAITING, ALICE_READY]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 0);
  assert.equal(calls.length, 4);
  assert.equal(ctx.out.length, 2);
  assert.match(ctx.out[0], /waiting .*alice=pending.*alice: pending/);
  assert.match(ctx.out[1], /ready/);
  assert.deepEqual(ctx.clock.sleeps, [60_000, 60_000, 60_000]);
});

test("watch --json emits JSON lines", async () => {
  const { root } = repoWith(watchConfig);
  const { gh } = scriptedSnapshots([ALICE_WAITING, ALICE_READY]);
  const ctx = context(root, gh, { json: true });
  assert.equal(await watch(["o/r#1", "--json"], ctx), 0);
  const lines = ctx.out.join("").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.ready), [false, true]);
  assert.equal(lines[0].repo, "o/r");
  assert.equal(lines[0].number, 1);
  assert.equal(lines[0].headSha, HEAD);
  assert.ok(Array.isArray(lines[0].reasons));
  assert.equal(lines[0].ts, new Date(NOW).toISOString());
});

test("watch --bounded exits 3 when not ready and clamps the last sleep", async () => {
  const { root } = repoWith(watchConfig);
  const { gh } = scriptedSnapshots([ALICE_WAITING]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1", "--bounded", "150"], ctx), 3);
  assert.deepEqual(ctx.clock.sleeps, [60_000, 60_000, 30_000]);
  assert.match(ctx.err.join(""), /not ready after 150s/);
});

test("watch exits 2 when --max-wait elapses", async () => {
  const { root } = repoWith(watchConfig);
  const { gh } = scriptedSnapshots([ALICE_WAITING]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1", "--max-wait=120"], ctx), 2);
  assert.deepEqual(ctx.clock.sleeps, [60_000, 60_000]);
  assert.match(ctx.err.join(""), /max-wait 120s reached/);
});

test("watch --max-wait defaults to review.max_hours * 3600", async () => {
  const { root } = repoWith({ review: { ...watchConfig.review, max_hours: 1, poll_seconds: 1800 } });
  const { gh } = scriptedSnapshots([ALICE_WAITING]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 2);
  assert.deepEqual(ctx.clock.sleeps, [1_800_000, 1_800_000]);
});

test("watch gives up with exit 1 after three consecutive gh errors", async () => {
  const { root } = repoWith(watchConfig);
  const { gh, calls } = scriptedSnapshots([new Error("boom")]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 1);
  assert.equal(calls.length, 3);
  assert.match(ctx.err.join(""), /3 consecutive gh errors/);
  assert.equal(ctx.out.length, 1);
  assert.match(ctx.out[0], /o\/r#1 error: boom/);
});

test("a successful poll resets the consecutive error count", async () => {
  const { root } = repoWith(watchConfig);
  const boom = new Error("boom");
  const { gh } = scriptedSnapshots([boom, boom, ALICE_WAITING, boom, boom, ALICE_READY]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 0);
});

test("watch several PRs: exit 0 only when every PR is ready", async () => {
  const { root } = repoWith(watchConfig);
  const seen = {};
  const { gh } = fakeGhRunner((query, variables) => {
    seen[variables.n] = (seen[variables.n] ?? 0) + 1;
    const ready = variables.n === 1 || seen[variables.n] > 1;
    return snapshotResponse(ready ? ALICE_READY : ALICE_WAITING);
  });
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1", "o/r#2"], ctx), 0);
  assert.equal(ctx.out.length, 3);
  assert.match(ctx.out[0], /^o\/r#1 ready/);
  assert.match(ctx.out[1], /^o\/r#2 waiting/);
  assert.match(ctx.out[2], /^o\/r#2 ready/);
});

test("watch in CI-only mode is ready as soon as CI passes", async () => {
  const { root } = repoWith({ review: { reviewers: [] } });
  const { gh } = scriptedSnapshots([{ ci: "PENDING" }, { ci: "SUCCESS" }]);
  const ctx = context(root, gh);
  assert.equal(await watch(["o/r#1"], ctx), 0);
  assert.match(ctx.out[0], /no reviewers .*ci: PENDING/);
});

test("watch rejects bad usage", async () => {
  const { root } = repoWith(watchConfig);
  const { gh } = scriptedSnapshots([ALICE_READY]);
  await assert.rejects(watch([], context(root, gh)), UsageError);
  await assert.rejects(watch(["o/r#1", "--bounded", "0"], context(root, gh)), UsageError);
  await assert.rejects(watch(["o/r#1", "--nope"], context(root, gh)), UsageError);
});
