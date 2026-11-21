import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";

const fixtureDir = fileURLToPath(new URL("./fixtures/plan/", import.meta.url));
const REPO = "meshin-dev/gdm-sandbox";
const urlFor = (number, repo = REPO) => `https://github.com/${repo}/issues/${number}`;

function fakeGh({ preset = [], fieldDefs = null, projectFields = [], readBackOverride = null } = {}) {
  const issues = preset.map((issue, index) => ({ number: index + 1, repo: REPO, parent: null, blockedBy: [], fields: {}, ...issue }));
  const calls = [];
  const writes = [];
  const find = (url) => issues.find((issue) => urlFor(issue.number, issue.repo) === url);
  const optionName = (def, id) => def.options.find((option) => option.id === id).name;

  async function cli(args) {
    calls.push(args);
    const [, action] = args;
    const option = (name) => args[args.indexOf(name) + 1];
    if (action === "list") {
      const rows = issues.map((issue) => ({ url: urlFor(issue.number, issue.repo), body: issue.body }));
      return { status: 0, stdout: JSON.stringify(rows), stderr: "" };
    }
    if (action === "create") {
      const issue = {
        number: issues.length + 1,
        repo: option("--repo"),
        title: option("--title"),
        body: readFileSync(option("--body-file"), "utf8"),
        type: option("--type") ?? null,
        parent: option("--parent") ?? null,
        blockedBy: args.includes("--blocked-by") ? option("--blocked-by").split(",") : [],
        fields: {},
      };
      issues.push(issue);
      writes.push(args);
      return { status: 0, stdout: `${urlFor(issue.number, issue.repo)}\n`, stderr: "" };
    }
    if (action === "edit") {
      writes.push(args);
      find(args[2]).parent = option("--parent");
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  }

  async function graphql(query, variables) {
    calls.push([query.match(/(?:query|mutation) (\w+)/)[1], variables]);
    const name = query.match(/(?:query|mutation) (\w+)/)[1];
    if (name === "IssueState") {
      const issue = find(variables.url);
      return { resource: { id: `ID${issue.number}`, url: variables.url, parent: issue.parent && { url: issue.parent }, blockedBy: { nodes: issue.blockedBy.map((url) => ({ url })) } } };
    }
    if (name === "AddBlockedBy") {
      writes.push([name, variables]);
      issues.find((issue) => `ID${issue.number}` === variables.issueId).blockedBy.push(urlFor(Number(variables.blockingIssueId.slice(2))));
      return {};
    }
    if (name === "IssueFieldDefs") {
      if (!fieldDefs) throw new Error("Could not resolve to an Organization");
      return { organization: { issueFields: { nodes: fieldDefs } } };
    }
    if (name === "IssueFieldValues") {
      const issue = issues.find((candidate) => `ID${candidate.number}` === variables.id);
      const nodes = Object.entries(issue.fields).map(([field, value]) => ({ value, field: { name: field } }));
      return { node: { issueFieldValues: { nodes } } };
    }
    if (name === "SetIssueFields") {
      writes.push([name, variables]);
      const issue = issues.find((candidate) => `ID${candidate.number}` === variables.input.issueId);
      for (const entry of variables.input.issueFields) {
        const def = fieldDefs.find((candidate) => candidate.id === entry.fieldId);
        const value = entry.singleSelectOptionId ? optionName(def, entry.singleSelectOptionId) : (entry.textValue ?? entry.numberValue);
        issue.fields[def.name] = readBackOverride ?? value;
      }
      return {};
    }
    if (name === "ProjectFields") return { organization: { projectV2: { id: "PROJECT", fields: { nodes: projectFields } } } };
    if (name === "AddProjectItem") {
      writes.push([name, variables]);
      return { addProjectV2ItemById: { item: { id: "ITEM" } } };
    }
    if (name === "UpdateProjectField") {
      writes.push([name, variables]);
      return {};
    }
    throw new Error(`unexpected graphql: ${name}`);
  }

  return { cli, graphql, issues, calls, writes };
}

function setup(manifest, bodies = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gdm-plan-"));
  const home = mkdtempSync(join(tmpdir(), "gdm-home-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(bodies)) writeFileSync(join(dir, name), text);
  return { dir, home, manifestPath: join(dir, "manifest.json") };
}

async function sync(env, gh, args, extra = {}) {
  const out = [];
  const err = [];
  const sleeps = [];
  const code = await main(["plan", "sync", ...args], {
    cwd: env.dir,
    env: { GDM_HOME: env.home },
    gh,
    sleep: async (ms) => sleeps.push(ms),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    ...extra,
  });
  return { code, out: out.join(""), err: err.join(""), sleeps };
}

const ledgerPath = (env) => join(env.home, "state", "github.com", "meshin-dev", "gdm-sandbox", "plans", "sample-plan.ledger.json");

function sampleEnv() {
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "sample.json"), "utf8"));
  const bodies = Object.fromEntries(["epic.md", "child-a.md", "child-b.md"].map((name) => [name, readFileSync(join(fixtureDir, name), "utf8")]));
  return setup(manifest, bodies);
}

const item = (key, extra = {}) => ({ key, title: `t ${key}`, type: null, body_file: `${key}.md`, parent: null, blocked_by: [], repo: null, labels: [], fields: {}, project_fields: {}, ...extra });
const plan = (items, extra = {}) => ({ plan_id: "sample-plan", repo: REPO, project_url: null, items, ...extra });

test("creates items in topological order, resolves placeholders, appends marker, writes ledger, paces writes", async () => {
  const env = sampleEnv();
  const gh = fakeGh();
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(gh.issues.map((issue) => issue.title), ["Epic: sample roadmap", "feat(sample): first deliverable", "feat(sample): second deliverable"]);
  const [epic, first, second] = gh.issues;
  assert.equal(epic.type, "Epic");
  assert.equal(first.parent, urlFor(1));
  assert.equal(second.parent, urlFor(1));
  assert.deepEqual(second.blockedBy, [urlFor(2)]);
  assert.match(second.body, /delivered in #2\./);
  assert.doesNotMatch(second.body, /\{\{/);
  assert.ok(second.body.trimEnd().endsWith("<!-- gdm:plan=sample-plan:B -->"));
  assert.match(result.out, /3 created, 0 existing, 0 failed/);
  assert.deepEqual(JSON.parse(readFileSync(ledgerPath(env), "utf8")), { EPIC: urlFor(1), A: urlFor(2), B: urlFor(3) });
  assert.deepEqual(result.sleeps, [1000, 1000]);
});

test("a second run with the ledger makes no create or edit calls and reports 0 created", async () => {
  const env = sampleEnv();
  const gh = fakeGh();
  await sync(env, gh, [env.manifestPath]);
  const before = gh.writes.length;
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /0 created, 3 existing, 0 failed/);
  assert.equal(gh.writes.length, before);
  assert.equal(gh.issues.length, 3);
});

test("with the ledger missing, the body marker search finds the existing issues and rewrites the ledger", async () => {
  const env = sampleEnv();
  const marker = (key) => `body\n\n<!-- gdm:plan=sample-plan:${key} -->\n`;
  const gh = fakeGh({
    preset: [
      { body: marker("EPIC") },
      { body: marker("A"), parent: urlFor(1) },
      { body: marker("B"), parent: urlFor(1), blockedBy: [urlFor(2)] },
      { body: "unrelated mentions gdm:plan=sample-plan:A without the marker comment" },
    ],
  });
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /0 created, 3 existing, 0 failed/);
  assert.equal(gh.writes.length, 0);
  assert.deepEqual(JSON.parse(readFileSync(ledgerPath(env), "utf8")), { EPIC: urlFor(1), A: urlFor(2), B: urlFor(3) });
  const search = gh.calls.find((call) => call[1] === "list");
  assert.ok(search.includes("gdm:plan=sample-plan:EPIC in:body"));
});

test("rerun on existing issues fills a missing parent and a missing blocked-by edge", async () => {
  const env = sampleEnv();
  const marker = (key) => `<!-- gdm:plan=sample-plan:${key} -->`;
  const gh = fakeGh({ preset: [{ body: marker("EPIC") }, { body: marker("A") }, { body: marker("B") }] });
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(gh.issues[1].parent, urlFor(1));
  assert.deepEqual(gh.issues[2].parent, urlFor(1));
  assert.deepEqual(gh.issues[2].blockedBy, [urlFor(2)]);
  assert.ok(gh.writes.some((call) => call[0] === "AddBlockedBy"));
  assert.ok(gh.writes.some((call) => call[1] === "edit" && call.includes("--parent")));
});

test("an 'already' error while filling an edge is tolerated", async () => {
  const env = sampleEnv();
  const gh = fakeGh({ preset: [{ body: "<!-- gdm:plan=sample-plan:EPIC -->" }, { body: "<!-- gdm:plan=sample-plan:A -->" }] });
  const originalCli = gh.cli;
  gh.cli = async (args) => (args[1] === "edit" ? { status: 1, stdout: "", stderr: "issue is already a sub-issue" } : originalCli(args));
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
});

test("an unresolved placeholder aborts only that item; others are created and the exit code is 1", async () => {
  const env = setup(plan([item("X"), item("Y"), item("Z", { parent: "X" })]), { "X.md": "see {{NOPE}}", "Y.md": "fine", "Z.md": "child" });
  const gh = fakeGh();
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 1);
  assert.deepEqual(gh.issues.map((issue) => issue.title), ["t Y"]);
  assert.match(result.err, /X: unresolved placeholder \{\{NOPE\}\}/);
  assert.match(result.err, /Z: dependency X has no issue yet/);
  assert.match(result.out, /1 created, 0 existing, 2 failed/);
});

test("a cross-repo item renders owner/repo#N references and an item repo overrides the manifest repo", async () => {
  const env = setup(plan([item("P", { repo: "other/lib" }), item("Q", { repo: null })]), { "P.md": "p", "Q.md": "uses {{P}}" });
  const gh = fakeGh();
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.equal(gh.issues[0].repo, "other/lib");
  assert.match(gh.issues[1].body, /uses other\/lib#1/);
});

test("a dependency cycle exits 1 before any gh call or ledger write", async () => {
  const env = setup(plan([item("A", { blocked_by: ["B"] }), item("B", { blocked_by: ["A"] })]), { "A.md": "a", "B.md": "b" });
  const gh = fakeGh();
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 1);
  assert.match(result.err, /cycle/);
  assert.equal(gh.calls.length, 0);
  assert.equal(existsSync(ledgerPath(env)), false);
});

test("--dry-run lists actions and writes nothing, not even a ledger", async () => {
  const env = sampleEnv();
  const gh = fakeGh();
  const result = await sync(env, gh, [env.manifestPath, "--dry-run"]);
  assert.equal(result.code, 0, result.err);
  assert.equal(gh.writes.length, 0);
  assert.equal(existsSync(ledgerPath(env)), false);
  assert.match(result.out, /would-create EPIC in meshin-dev\/gdm-sandbox/);
  assert.match(result.out, /would-create B .*blocked-by A/);
  assert.match(result.out, /dry-run: 3 would be created, 0 existing, 0 failed/);
});

test("manifest validation: unknown keys, a missing body file and duplicate keys exit 1 without gh calls", async () => {
  const cases = [
    [plan([item("A", { surprise: 1 })]), { "A.md": "a" }, /unknown key "surprise"/],
    [plan([item("A")]), {}, /body file not found: A\.md/],
    [plan([item("A"), item("A")]), { "A.md": "a" }, /duplicate key "A"/],
    [{ ...plan([item("A")]), extra: true }, { "A.md": "a" }, /manifest: unknown key "extra"/],
    [plan([item("A", { parent: "GHOST" })]), { "A.md": "a" }, /unknown key "GHOST"/],
  ];
  for (const [manifest, bodies, pattern] of cases) {
    const env = setup(manifest, bodies);
    const gh = fakeGh();
    const result = await sync(env, gh, [env.manifestPath]);
    assert.equal(result.code, 1);
    assert.match(result.err, pattern);
    assert.equal(gh.calls.length, 0);
  }
});

test("missing manifest argument is a usage error", async () => {
  const env = setup(plan([item("A")]), { "A.md": "a" });
  assert.equal((await sync(env, fakeGh(), [])).code, 64);
});

const priorityDefs = [{ __typename: "IssueFieldSingleSelect", id: "F1", name: "Priority", options: [{ id: "O1", name: "High" }, { id: "O2", name: "Low" }] }];

test("issue fields are set and read back; a second run does not write them again", async () => {
  const env = setup(plan([item("A", { fields: { Priority: "High" } })]), { "A.md": "a" });
  const gh = fakeGh({ fieldDefs: priorityDefs });
  const first = await sync(env, gh, [env.manifestPath]);
  assert.equal(first.code, 0, first.err);
  assert.equal(gh.issues[0].fields.Priority, "High");
  const writesAfterFirst = gh.writes.length;
  const second = await sync(env, gh, [env.manifestPath]);
  assert.equal(second.code, 0, second.err);
  assert.equal(gh.writes.length, writesAfterFirst);
});

test("an issue field read-back mismatch exits 1 naming the field", async () => {
  const env = setup(plan([item("A", { fields: { Priority: "High" } })]), { "A.md": "a" });
  const gh = fakeGh({ fieldDefs: priorityDefs, readBackOverride: "Low" });
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 1);
  assert.match(result.err, /field Priority/);
});

test("unavailable issue fields fall back to project fields and log it", async () => {
  const projectFields = [{ __typename: "ProjectV2SingleSelectField", id: "PF1", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "PO1", name: "High" }] }];
  const manifest = plan([item("A", { fields: { Priority: "High" } })], { project_url: "https://github.com/orgs/meshin-dev/projects/3" });
  const env = setup(manifest, { "A.md": "a" });
  const gh = fakeGh({ projectFields });
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /issue fields unavailable/);
  const update = gh.writes.find((call) => call[0] === "UpdateProjectField");
  assert.deepEqual(update[1].input, { projectId: "PROJECT", itemId: "ITEM", fieldId: "PF1", value: { singleSelectOptionId: "PO1" } });
});

test("project_url adds each issue to the project and sets project_fields", async () => {
  const projectFields = [{ __typename: "ProjectV2Field", id: "PF2", name: "Effort", dataType: "NUMBER" }];
  const manifest = plan([item("A", { project_fields: { Effort: 3 } })], { project_url: "https://github.com/orgs/meshin-dev/projects/3" });
  const env = setup(manifest, { "A.md": "a" });
  const gh = fakeGh({ projectFields });
  const result = await sync(env, gh, [env.manifestPath]);
  assert.equal(result.code, 0, result.err);
  assert.ok(gh.writes.some((call) => call[0] === "AddProjectItem" && call[1].contentId === "ID1"));
  assert.deepEqual(gh.writes.find((call) => call[0] === "UpdateProjectField")[1].input.value, { number: 3 });
});

test("--json prints one summary object", async () => {
  const env = sampleEnv();
  const result = await sync(env, fakeGh(), [env.manifestPath, "--json"]);
  const payload = JSON.parse(result.out);
  assert.equal(payload.summary, "3 created, 0 existing, 0 failed");
  assert.deepEqual(payload.items.map((entry) => entry.key), ["EPIC", "A", "B"]);
});
