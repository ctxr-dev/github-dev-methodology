import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { run } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/validate-tree.mjs";
import { UsageError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { FakeGithub, capture } from "./helpers/fake-github.mjs";

const ROOT_URL = "https://github.com/o/r/issues/1";

function chain(length) {
  const fake = new FakeGithub();
  for (let number = 1; number <= length; number += 1) fake.add(`o/r#${number}`);
  for (let number = 2; number <= length; number += 1) fake.link(`o/r#${number - 1}`, `o/r#${number}`);
  return fake;
}

async function validate(fake, args) {
  const io = capture();
  const code = await run(args, { ...io, gh: fake.gh(), json: args.includes("--json"), cwd: "/tmp" });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

test("101 children across two pages are all visited", async () => {
  const fake = new FakeGithub().add("o/r#1");
  for (let number = 2; number <= 102; number += 1) fake.add(`o/r#${number}`).link("o/r#1", `o/r#${number}`);
  const { code, stdout } = await validate(fake, [ROOT_URL]);
  assert.equal(code, 0);
  assert.match(stdout, /tree ok: 102 issues under o\/r#1, max depth 1/);
  const rootPages = fake.graphqlCalls.filter((call) => call.variables.number === 1).map((call) => call.variables.cursor);
  assert.deepEqual(rootPages, [null, "100"]);
});

test("depth 4 passes and depth 5 fails", async () => {
  assert.equal((await validate(chain(5), [ROOT_URL])).code, 0);
  const { code, stderr } = await validate(chain(6), [ROOT_URL]);
  assert.equal(code, 1);
  assert.match(stderr, /too-deep: o\/r#6: depth 5 exceeds 4/);
});

test("a cycle fails and prints no success line", async () => {
  const fake = new FakeGithub().add("o/r#1").add("o/r#2").add("o/r#3");
  fake.link("o/r#1", "o/r#2").link("o/r#2", "o/r#3");
  fake.issues.get("o/r#3").subIssues.push("o/r#1");
  const { code, stdout, stderr } = await validate(fake, [ROOT_URL]);
  assert.equal(code, 1);
  assert.match(stderr, /cycle: o\/r#1: o\/r#1 -> o\/r#2 -> o\/r#3 -> o\/r#1/);
  assert.doesNotMatch(stdout, /tree ok/);
});

test("a child with no parent is an orphan", async () => {
  const fake = new FakeGithub().add("o/r#1").add("o/r#2");
  fake.issues.get("o/r#1").subIssues.push("o/r#2");
  const { code, stdout, stderr } = await validate(fake, [ROOT_URL]);
  assert.equal(code, 1);
  assert.match(stderr, /orphan: o\/r#2: listed under o\/r#1 but has no parent/);
  assert.equal(stdout, "");
});

test("a child that claims a different parent is asymmetric", async () => {
  const fake = new FakeGithub().add("o/r#1").add("o/r#2").add("o/r#3");
  fake.link("o/r#1", "o/r#2");
  fake.issues.get("o/r#1").subIssues.push("o/r#3");
  fake.issues.get("o/r#3").parent = "o/r#2";
  const { code, stderr } = await validate(fake, [ROOT_URL]);
  assert.equal(code, 1);
  assert.match(stderr, /asymmetric: o\/r#3: listed under o\/r#1 but its parent is o\/r#2/);
});

test("children in a sibling repo are followed and the owner/repo#N form is accepted", async () => {
  const fake = new FakeGithub().add("o/r#1").add("o/other#7");
  fake.link("o/r#1", "o/other#7");
  const { code, stdout } = await validate(fake, ["o/r#1"]);
  assert.equal(code, 0);
  assert.match(stdout, /2 issues/);
});

test("a missing root issue fails the command", async () => {
  await assert.rejects(validate(new FakeGithub(), [ROOT_URL]), /issue not found: o\/r#1/);
});

test("--json prints a machine-readable result on failure too", async () => {
  const { code, stdout } = await validate(chain(6), [ROOT_URL, "--json"]);
  assert.equal(code, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.defects[0].kind, "too-deep");
});

test("--up prints the parent chain and every open blocker, ignoring closed ones", async () => {
  const fake = chain(3);
  fake.add("o/r#9", { title: "Open blocker" }).add("o/r#8", { title: "Done blocker", state: "CLOSED" });
  fake.issues.get("o/r#2").blockedBy.push("o/r#9", "o/r#8");
  const { code, stdout } = await validate(fake, ["https://github.com/o/r/issues/3", "--up"]);
  assert.equal(code, 0);
  assert.match(stdout, /chain: o\/r#3 -> o\/r#2 -> o\/r#1/);
  assert.match(stdout, /blocked-by: o\/r#9 "Open blocker" \(open\) blocks o\/r#2/);
  assert.doesNotMatch(stdout, /o\/r#8/);
});

test("--up fails when the parent chain loops", async () => {
  const fake = new FakeGithub().add("o/r#1").add("o/r#2");
  fake.issues.get("o/r#1").parent = "o/r#2";
  fake.issues.get("o/r#2").parent = "o/r#1";
  const { code, stderr } = await validate(fake, [ROOT_URL, "--up"]);
  assert.equal(code, 1);
  assert.match(stderr, /cycle/);
});

test("usage errors: missing or malformed issue reference", async () => {
  await assert.rejects(validate(new FakeGithub(), []), UsageError);
  await assert.rejects(validate(new FakeGithub(), ["not-an-issue"]), UsageError);
  await assert.rejects(validate(new FakeGithub(), [ROOT_URL, "--bogus"]), /unknown flag --bogus/);
});

test("the dispatcher routes `validate tree` to the command", async () => {
  const io = capture();
  const code = await main(["validate", "tree", ROOT_URL], { ...io, gh: chain(2).gh() });
  assert.equal(code, 0);
  assert.match(io.out.join(""), /tree ok: 2 issues/);
});
