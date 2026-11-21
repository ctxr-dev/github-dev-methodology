import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/validate-labels.mjs";
import { ConfigMissingError, UsageError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { createGh } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";
import { capture } from "./helpers/fake-github.mjs";

const assets = new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/assets/", import.meta.url);
const locked = JSON.parse(readFileSync(new URL("labels.json", assets), "utf8")).locked;
const template = JSON.parse(readFileSync(new URL("config.template.json", assets), "utf8"));

const canonical = () => locked.map(({ name, color, description }) => ({ name, color, description }));

function fakeLabels(repos, { failOn = [] } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[1] === "list") {
      const repo = args[args.indexOf("--repo") + 1];
      return { status: 0, stdout: JSON.stringify(repos[repo]), stderr: "" };
    }
    const failed = failOn.includes(args[2]);
    return { status: failed ? 1 : 0, stdout: "", stderr: failed ? "HTTP 422" : "" };
  };
  return { runner, calls };
}

async function validate(fake, args, cwd = "/tmp") {
  const io = capture();
  const code = await run(args, { ...io, gh: createGh(fake.runner), json: false, cwd });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

const mutations = (calls) => calls.filter((args) => args[1] !== "list");

test("canonical labels pass in every listed repo", async () => {
  const fake = fakeLabels({ "o/a": canonical(), "o/b": canonical() });
  const { code, stdout } = await validate(fake, ["o", "--repos", "a,b"]);
  assert.equal(code, 0);
  assert.match(stdout, /labels ok: 9 locked labels in 2 repos/);
});

test("a missing label and a drifted color fail without --fix and change nothing", async () => {
  const labels = canonical().filter((label) => label.name !== "type:bug");
  labels.find((label) => label.name === "type:docs").color = "000000";
  const fake = fakeLabels({ "o/a": labels });
  const { code, stdout, stderr } = await validate(fake, ["o", "--repos", "a"]);
  assert.equal(code, 1);
  assert.match(stdout, /MISSING o\/a type:bug/);
  assert.match(stdout, /DRIFT o\/a type:docs/);
  assert.doesNotMatch(stdout, /labels ok/);
  assert.match(stderr, /2 drifts; run with --fix/);
  assert.deepEqual(mutations(fake.calls), []);
});

test("color comparison ignores case and a leading #", async () => {
  const labels = canonical().map((label) => ({ ...label, color: `#${label.color.toLowerCase()}` }));
  assert.equal((await validate(fakeLabels({ "o/a": labels }), ["o", "--repos", "a"])).code, 0);
});

test("--fix creates missing labels and edits drifted ones, then exits 0", async () => {
  const labels = canonical().filter((label) => label.name !== "type:bug");
  labels.find((label) => label.name === "scope:breaking").description = "wrong";
  const fake = fakeLabels({ "o/a": labels });
  const { code, stdout } = await validate(fake, ["o", "--repos", "a", "--fix"]);
  assert.equal(code, 0);
  assert.match(stdout, /FIXED o\/a type:bug/);
  assert.match(stdout, /labels ok: .*\(2 repaired\)/);
  const [create, edit] = mutations(fake.calls);
  assert.deepEqual(create.slice(0, 3), ["label", "create", "type:bug"]);
  assert.ok(create.includes("--force"));
  assert.deepEqual(edit.slice(0, 3), ["label", "edit", "scope:breaking"]);
  assert.ok(edit.includes("--color") && edit.includes("B60205"));
});

test("--fix exits 1 when any repair fails and names the label", async () => {
  const labels = canonical().filter((label) => !["type:bug", "type:chore"].includes(label.name));
  const fake = fakeLabels({ "o/a": labels }, { failOn: ["type:chore"] });
  const { code, stdout, stderr } = await validate(fake, ["o", "--repos", "a", "--fix"]);
  assert.equal(code, 1);
  assert.match(stdout, /FIXED o\/a type:bug/);
  assert.match(stdout, /FIX-FAILED o\/a type:chore/);
  assert.match(stderr, /could not repair type:chore: HTTP 422/);
  assert.doesNotMatch(stdout, /labels ok/);
});

test("a failing label list is an error", async () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "HTTP 404" });
  await assert.rejects(validate({ runner, calls: [] }, ["o", "--repos", "a"]), /gh label list failed for o\/a: HTTP 404/);
});

test("without --repos the repos come from the repo config", async () => {
  const root = mkdtempSync(join(tmpdir(), "gdm-labels-"));
  mkdirSync(join(root, ".github-dev-methodology"));
  const config = structuredClone(template);
  Object.assign(config.projects["my-project"], { primary_repo: "main", sibling_repos: ["side"] });
  writeFileSync(join(root, ".github-dev-methodology", "config.json"), JSON.stringify(config));
  const fake = fakeLabels({ "o/main": canonical(), "o/side": canonical() });
  const { code, stdout } = await validate(fake, ["o"], root);
  assert.equal(code, 0);
  assert.match(stdout, /in 2 repos/);
});

test("without --repos and without a config the command fails with the config error", async () => {
  const root = mkdtempSync(join(tmpdir(), "gdm-labels-"));
  await assert.rejects(validate(fakeLabels({}), ["o"], root), ConfigMissingError);
});

test("usage errors", async () => {
  await assert.rejects(validate(fakeLabels({}), []), UsageError);
  await assert.rejects(validate(fakeLabels({}), ["o", "--repos", " , "]), UsageError);
});
