import assert from "node:assert/strict";
import { test } from "node:test";
import { GhError, GhMissingError, GhRateLimitError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { createGh } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";

const ok = (payload) => ({ status: 0, stdout: JSON.stringify(payload), stderr: "" });

function scriptedRunner(responses) {
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args, input: options?.input });
    return responses.shift();
  };
  return { runner, calls };
}

test("graphqlPaginated follows pageInfo across two pages and concatenates nodes", async () => {
  const pages = [
    ok({ data: { repository: { issues: { nodes: [{ n: 1 }, { n: 2 }], pageInfo: { hasNextPage: true, endCursor: "C1" } } } } }),
    ok({ data: { repository: { issues: { nodes: [{ n: 3 }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ];
  const { runner, calls } = scriptedRunner(pages);
  const gh = createGh(runner);
  const nodes = await gh.graphqlPaginated("query($cursor: String) {}", { owner: "o" }, "repository.issues");
  assert.deepEqual(nodes, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(calls.length, 2);
  const [first, second] = calls.map((call) => JSON.parse(call.input).variables);
  assert.deepEqual(first, { owner: "o", cursor: null });
  assert.deepEqual(second, { owner: "o", cursor: "C1" });
});

test("graphqlPaginated returns an empty list when the connection is null", async () => {
  const { runner } = scriptedRunner([ok({ data: { repository: null } })]);
  assert.deepEqual(await createGh(runner).graphqlPaginated("q", {}, "repository.issues"), []);
});

test("graphql throws GhError carrying the GraphQL error messages", async () => {
  const { runner } = scriptedRunner([ok({ errors: [{ message: "Could not resolve" }], data: null })]);
  await assert.rejects(createGh(runner).graphql("q"), (error) => {
    assert.ok(error instanceof GhError);
    assert.match(error.message, /Could not resolve/);
    return true;
  });
});

test("secondary rate limit sleeps 60 seconds and retries until success", async () => {
  const limited = { status: 1, stdout: "", stderr: "You have exceeded a secondary rate limit (HTTP 403)" };
  const { runner, calls } = scriptedRunner([limited, limited, ok({ data: { viewer: "me" } })]);
  const sleeps = [];
  const gh = createGh(runner, { sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(await gh.graphql("q"), { viewer: "me" });
  assert.deepEqual(sleeps, [60_000, 60_000]);
  assert.equal(calls.length, 3);
});

test("rate limit gives up after three retries", async () => {
  const limited = { status: 1, stdout: "", stderr: "secondary rate limit" };
  const { runner, calls } = scriptedRunner([limited, limited, limited, limited, limited]);
  const gh = createGh(runner, { sleep: async () => {} });
  await assert.rejects(gh.cli(["api", "x"]), GhRateLimitError);
  assert.equal(calls.length, 4);
});

test("a runner failure with code ENOENT becomes GhMissingError", async () => {
  const thrown = createGh(() => {
    throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
  });
  await assert.rejects(thrown.cli(["--version"]), GhMissingError);
  const returned = createGh(() => ({ status: 1, stdout: "", stderr: "", error: { code: "ENOENT", message: "x" } }));
  await assert.rejects(returned.rest("GET", "/user"), GhMissingError);
});

test("non-zero exit throws GhError with stderr and http status", async () => {
  const { runner } = scriptedRunner([{ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }]);
  await assert.rejects(createGh(runner).rest("GET", "/repos/x/y"), (error) => {
    assert.ok(error instanceof GhError);
    assert.equal(error.httpStatus, 404);
    assert.match(error.stderr, /Not Found/);
    return true;
  });
});

test("rest sends the body on stdin and parses the response", async () => {
  const { runner, calls } = scriptedRunner([ok({ id: 7 })]);
  const result = await createGh(runner).rest("POST", "/repos/o/r/issues", { title: "t" });
  assert.deepEqual(result, { id: 7 });
  assert.deepEqual(calls[0].args, ["api", "-X", "POST", "/repos/o/r/issues", "--input", "-"]);
  assert.deepEqual(JSON.parse(calls[0].input), { title: "t" });
});

test("cli returns status, stdout and stderr without throwing on failure", async () => {
  const { runner } = scriptedRunner([{ status: 2, stdout: "out", stderr: "err" }]);
  assert.deepEqual(await createGh(runner).cli(["pr", "view"]), { status: 2, stdout: "out", stderr: "err" });
});
