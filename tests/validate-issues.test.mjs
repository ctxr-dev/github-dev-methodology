import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/validate-issues.mjs";
import { UsageError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { missingSections, readSections } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/issue-headings.mjs";
import { FakeGithub, capture } from "./helpers/fake-github.mjs";

const GOOD_BODY = [
  "## Why",
  "Because.",
  "## Action items",
  "- [ ] do it",
  "## Acceptance",
  "tests pass",
  "## Implementation pointers",
  "- file.mjs",
  "## Test plan",
  "- npm test",
].join("\n");

const EPIC_BODY = "## Mission\nDeliver.\n\n## Children\n- A\n\n## Decision log\n- 2026-01-01: chose X\n";

async function validate(fake, args) {
  const io = capture();
  const code = await run(args, { ...io, gh: fake.gh(), json: args.includes("--json"), cwd: "/tmp" });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

test("a conforming issue passes with a success line", async () => {
  const fake = new FakeGithub().add("o/r#1", { body: GOOD_BODY });
  const { code, stdout, stderr } = await validate(fake, ["o/r"]);
  assert.equal(code, 0);
  assert.match(stdout, /issues ok: 1 checked in o\/r/);
  assert.equal(stderr, "");
});

test("a heading inside a code fence does not count", async () => {
  const body = GOOD_BODY.replace("## Acceptance\ntests pass", "```markdown\n## Acceptance\ntests pass\n```");
  const { code, stderr } = await validate(new FakeGithub().add("o/r#1", { body }), ["o/r"]);
  assert.equal(code, 1);
  assert.match(stderr, /#1 "Issue o\/r#1": missing ## Acceptance \(template: .*assets\/issue-body\.md\)/);
});

test("an empty section counts as missing, including comment-only content", async () => {
  const body = GOOD_BODY.replace("## Test plan\n- npm test", "## Test plan\n\n<!-- fill me -->\n").replace("tests pass", "");
  const { code, stderr, stdout } = await validate(new FakeGithub().add("o/r#1", { body }), ["o/r"]);
  assert.equal(code, 1);
  assert.match(stderr, /missing ## Acceptance, ## Test plan/);
  assert.doesNotMatch(stdout, /issues ok/);
});

test("a missing heading is reported and the others are not", async () => {
  const body = GOOD_BODY.replace("## Why\nBecause.\n", "");
  const { stderr } = await validate(new FakeGithub().add("o/r#1", { body }), ["o/r"]);
  assert.match(stderr, /missing ## Why \(template/);
  assert.doesNotMatch(stderr, /## Action items/);
});

test("an epic by issue type needs Mission, Children and Decision log", async () => {
  const fake = new FakeGithub()
    .add("o/r#1", { issueType: "Epic", body: EPIC_BODY })
    .add("o/r#2", { issueType: "Epic", body: GOOD_BODY });
  const { code, stderr } = await validate(fake, ["o/r"]);
  assert.equal(code, 1);
  assert.match(stderr, /#2 epic "Issue o\/r#2": missing ## Mission, ## Children, ## Decision log \(template: .*epic-body\.md\)/);
  assert.doesNotMatch(stderr, /#1 /);
});

test("an epic is detected from the type:epic label when there is no native type", async () => {
  const fake = new FakeGithub().add("o/r#1", { labels: ["type:epic"], body: EPIC_BODY });
  assert.equal((await validate(fake, ["o/r"])).code, 0);
});

test("--touched limits the check, in both flag forms, and defaults to all states", async () => {
  const fake = new FakeGithub()
    .add("o/r#1", { body: GOOD_BODY })
    .add("o/r#2", { body: "" })
    .add("o/r#3", { body: "", state: "CLOSED" });
  assert.equal((await validate(fake, ["o/r", "--touched", "1"])).code, 0);
  assert.equal((await validate(fake, ["o/r", "--touched=1"])).code, 0);
  const both = await validate(fake, ["o/r", "--touched=1,3"]);
  assert.equal(both.code, 1);
  assert.match(both.stderr, /#3/);
  assert.doesNotMatch(both.stderr, /#2/);
  assert.match(both.stderr, /missing ## Why/);
});

test("--touched fails for an issue that does not exist", async () => {
  await assert.rejects(validate(new FakeGithub(), ["o/r", "--touched", "9"]), /issue not found: o\/r#9/);
});

test("closed issues are skipped by default and checked with --state all", async () => {
  const fake = new FakeGithub().add("o/r#1", { body: GOOD_BODY }).add("o/r#2", { body: "", state: "CLOSED" });
  assert.equal((await validate(fake, ["o/r"])).code, 0);
  assert.equal((await validate(fake, ["o/r", "--state", "all"])).code, 1);
});

test("more than one page of issues is checked", async () => {
  const fake = new FakeGithub();
  for (let number = 1; number <= 101; number += 1) fake.add(`o/r#${number}`, { body: number === 101 ? "" : GOOD_BODY });
  const { code, stderr } = await validate(fake, ["o/r"]);
  assert.equal(code, 1);
  assert.match(stderr, /#101 /);
  assert.equal(stderr.trim().split("\n").length, 1);
});

test("--json reports the result", async () => {
  const fake = new FakeGithub().add("o/r#1", { body: "" });
  const { code, stdout } = await validate(fake, ["o/r", "--json"]);
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(stdout).failures[0].missing.slice(0, 2), ["Why", "Action items"]);
});

test("usage errors", async () => {
  await assert.rejects(validate(new FakeGithub(), []), UsageError);
  await assert.rejects(validate(new FakeGithub(), ["o/r", "--state", "bogus"]), UsageError);
  await assert.rejects(validate(new FakeGithub(), ["o/r", "--touched", "a,b"]), UsageError);
  await assert.rejects(validate(new FakeGithub(), ["o/r", "--touched"]), UsageError);
});

test("readSections handles tilde fences, nested fences and subheadings", () => {
  const body = ["## A", "~~~", "## B", "~~~", "### sub", "text", "````", "```", "## C", "````", "## D", "x"].join("\n");
  const sections = readSections(body);
  assert.deepEqual([...sections.keys()], ["a", "d"]);
  assert.deepEqual(missingSections(body, ["A", "B", "C", "D"]), ["B", "C"]);
});
