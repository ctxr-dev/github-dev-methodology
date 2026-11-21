import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { createGh } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";
import { parseScopes } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/doctor-checks.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const ok = (stdout) => ({ status: 0, stdout, stderr: "" });

function fakeGh(options = {}) {
  const state = {
    authStatus: 0,
    scopes: "'repo', 'project', 'read:org'",
    extensions: "gh stack\tgithub/gh-stack\tv0.3.0\n",
    deleteBranchOnMerge: true,
    copilotReviewed: true,
    missing: false,
    ...options,
  };
  const calls = [];
  const runner = (args, { input } = {}) => {
    calls.push(args.join(" "));
    if (state.missing) return { status: 1, stdout: "", stderr: "", error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) };
    const key = args.join(" ");
    if (key === "auth status") {
      return { status: state.authStatus, stdout: state.authStatus === 0 ? `github.com\n  - Token scopes: ${state.scopes}\n` : "", stderr: state.authStatus === 0 ? "" : "You are not logged in" };
    }
    if (key === "extension list") return ok(state.extensions);
    if (key === "api -X GET repos/acme/widgets") return ok(JSON.stringify({ delete_branch_on_merge: state.deleteBranchOnMerge }));
    if (key === "api graphql --input -" && JSON.parse(input).query.includes("pullRequests")) {
      const review = { author: { login: state.copilotReviewed ? "copilot-pull-request-reviewer" : "someone" } };
      const nodes = Array.from({ length: 10 }, (_, number) => ({ number, reviews: { nodes: [review] } }));
      return ok(JSON.stringify({ data: { repository: { pullRequests: { nodes } } } }));
    }
    return { status: 1, stdout: "", stderr: `unexpected gh call: ${key}` };
  };
  return { gh: createGh(runner, { sleep: async () => {} }), calls };
}

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "gdm-doctor-home-"));
  const root = mkdtempSync(join(tmpdir(), "gdm-doctor-repo-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  const env = { HOME: home, GDM_HOME: join(home, ".gdm") };
  return { home, root, env, worktreesRoot: join(home, ".gdm", "worktrees") };
}

function writeConfig(root, project = {}) {
  mkdirSync(join(root, ".github-dev-methodology"), { recursive: true });
  const config = { schema_version: 1, active_project: "p", projects: { p: { preset: "pr-only", org: "acme", primary_repo: "widgets", ...project } } };
  writeFileSync(join(root, ".github-dev-methodology/config.json"), JSON.stringify(config));
}

async function doctor(box, gh, extra = {}, argv = ["doctor"]) {
  const out = [];
  const err = [];
  const code = await main(argv, { cwd: box.root, env: box.env, gh, stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) }, ...extra });
  return { code, out: out.join(""), err: err.join("") };
}

async function initialised(box, project) {
  writeConfig(box.root, project);
  writeFileSync(join(box.root, "AGENTS.md"), "# A\n\n## Methodologies\n\n<!-- gdm:start -->\nx\n<!-- gdm:end -->\n");
}

test("parseScopes handles quoted and unquoted lists and absent lines", () => {
  assert.deepEqual(parseScopes("  - Token scopes: 'gist', 'read:org', 'repo'\n"), ["gist", "read:org", "repo"]);
  assert.deepEqual(parseScopes("Token scopes: repo, project"), ["repo", "project"]);
  assert.equal(parseScopes("Logged in with a fine-grained token"), null);
});

test("no config, legacy clone and legacy config file are errors naming gdm config migrate", async () => {
  const box = sandbox();
  mkdirSync(join(box.root, ".agents/ctxr-dev/github-dev-methodology"), { recursive: true });
  writeFileSync(join(box.root, ".agents/ctxr-dev/github-dev-methodology.config.local.md"), "x");
  const result = await doctor(box, fakeGh().gh);
  assert.equal(result.code, 1);
  assert.match(result.out, /^error: repo config missing: no \.github-dev-methodology\/config\.json found; run: gdm init$/m);
  assert.match(result.out, /^error: legacy clone present: .*\.agents\/ctxr-dev\/github-dev-methodology; .*gdm config migrate/m);
  assert.match(result.out, /^error: legacy config present: .*github-dev-methodology\.config\.local\.md; migrate it with: gdm config migrate/m);
});

test("worktrees on and Claude present without additionalDirectories warns with the exact entry", async () => {
  const box = sandbox();
  await initialised(box);
  mkdirSync(join(box.home, ".claude"));
  const result = await doctor(box, fakeGh().gh);
  assert.equal(result.code, 0, result.out);
  const entry = JSON.stringify({ permissions: { additionalDirectories: [box.worktreesRoot] } });
  assert.ok(result.out.includes(`warn: Claude Code will prompt for edits in ${box.worktreesRoot}; add to ~/.claude/settings.json: ${entry}`), result.out);
});

test("a Claude additionalDirectories entry that is a prefix of the worktrees root silences the warning", async () => {
  const box = sandbox();
  await initialised(box);
  mkdirSync(join(box.home, ".claude"));
  writeFileSync(join(box.home, ".claude/settings.json"), JSON.stringify({ permissions: { additionalDirectories: ["~/.gdm"] } }));
  const result = await doctor(box, fakeGh().gh);
  assert.doesNotMatch(result.out, /Claude Code will prompt/);
  writeFileSync(join(box.home, ".claude/settings.json"), JSON.stringify({ permissions: { additionalDirectories: [join(box.home, ".gdm-other")] } }));
  assert.match((await doctor(box, fakeGh().gh)).out, /Claude Code will prompt/);
});

test("Codex config without writable_roots warns; a covering entry silences it; absent file is quiet", async () => {
  const box = sandbox();
  await initialised(box);
  assert.doesNotMatch((await doctor(box, fakeGh().gh)).out, /Codex will prompt/);
  mkdirSync(join(box.home, ".codex"));
  writeFileSync(join(box.home, ".codex/config.toml"), 'model = "x"\n');
  const warned = await doctor(box, fakeGh().gh);
  assert.ok(warned.out.includes(`add under [sandbox_workspace_write] in ~/.codex/config.toml: writable_roots = ["${box.worktreesRoot}"]`), warned.out);
  writeFileSync(join(box.home, ".codex/config.toml"), `[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/x",\n  "${box.worktreesRoot}",\n]\n`);
  assert.doesNotMatch((await doctor(box, fakeGh().gh)).out, /Codex will prompt/);
});

test("a healthy initialised repo prints doctor: ok and exits 0", async () => {
  const box = sandbox();
  await initialised(box);
  const result = await doctor(box, fakeGh().gh);
  assert.deepEqual([result.code, result.out], [0, "doctor: ok\n"]);
});

test("warnings: branch auto-delete off, no Copilot reviews, missing AGENTS.md block", async () => {
  const box = sandbox();
  writeConfig(box.root);
  const result = await doctor(box, fakeGh({ deleteBranchOnMerge: false, copilotReviewed: false }).gh);
  assert.equal(result.code, 0);
  assert.match(result.out, /^warn: delete_branch_on_merge is off on acme\/widgets/m);
  assert.match(result.out, /^warn: copilot_review is on but Copilot reviewed 0 of the last 10 merged PRs on acme\/widgets$/m);
  assert.match(result.out, /^warn: AGENTS\.md has no gdm marker block; run: gdm init$/m);
});

test("--json reports ok, errors and warnings", async () => {
  const box = sandbox();
  writeConfig(box.root);
  const report = JSON.parse((await doctor(box, fakeGh().gh, {}, ["doctor", "--json"])).out);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1);
  const failing = JSON.parse((await doctor(sandbox(), fakeGh().gh, {}, ["doctor", "--json"])).out);
  assert.equal(failing.ok, false);
  assert.match(failing.errors[0], /repo config missing/);
});

test("gh missing and gh unauthenticated are errors", async () => {
  const box = sandbox();
  await initialised(box);
  const missing = await doctor(box, fakeGh({ missing: true }).gh);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /^error: gh CLI not found on PATH/m);
  const loggedOut = await doctor(box, fakeGh({ authStatus: 1 }).gh);
  assert.equal(loggedOut.code, 1);
  assert.match(loggedOut.out, /^error: gh is not authenticated; run: gh auth login$/m);
});

test("token scopes are required per enabled feature", async () => {
  const box = sandbox();
  await initialised(box, { preset: "full" });
  const thin = await doctor(box, fakeGh({ scopes: "'repo'" }).gh);
  assert.equal(thin.code, 1);
  assert.match(thin.out, /lacks scope "project" \(needed by plan_to_issues, parallel_validation, cold_start, plan_deprecation\); run: gh auth refresh -s project/);
  assert.match(thin.out, /lacks scope "read:org"/);
  assert.doesNotMatch(thin.out, /lacks scope "repo"/);
  const noRepo = await doctor(box, fakeGh({ scopes: "'project', 'admin:org'" }).gh);
  assert.match(noRepo.out, /lacks scope "repo" \(needed by pr_loop, issue_schema, issue_lifecycle\)/);
  assert.doesNotMatch(noRepo.out, /read:org/);
  assert.equal((await doctor(box, fakeGh({ scopes: "'repo', 'project', 'read:org'" }).gh)).code, 0);
});

test("stacked_prs needs the gh-stack extension", async () => {
  const box = sandbox();
  await initialised(box, { features: { stacked_prs: true } });
  const missing = await doctor(box, fakeGh({ extensions: "gh copilot\tgithub/gh-copilot\tv1\n" }).gh);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /^error: stacked_prs is on but gh extension github\/gh-stack is missing; run: gh extension install github\/gh-stack --pin v0\.3\.0$/m);
  assert.equal((await doctor(box, fakeGh().gh)).code, 0);
});

test("an invalid repo config reports each problem; unknown keys and dependency violations are errors", async () => {
  const box = sandbox();
  writeConfig(box.root, { bogus: 1 });
  const unknownKey = await doctor(box, fakeGh().gh);
  assert.equal(unknownKey.code, 1);
  assert.match(unknownKey.out, /^error: repo config invalid .*: config\.projects\.p\.bogus: unknown key$/m);
  writeConfig(box.root, { features: { pr_loop: false } });
  assert.match((await doctor(box, fakeGh().gh)).out, /feature "copilot_review" requires "pr_loop", which is off/);
});

test("Node older than 20 is an error", async () => {
  const box = sandbox();
  await initialised(box);
  const result = await doctor(box, fakeGh().gh, { nodeVersion: "18.19.0" });
  assert.equal(result.code, 1);
  assert.match(result.out, /^error: Node 18\.19\.0 is too old/m);
});

test("worktrees on: a registered worktree outside the worktrees root is an error, one inside is fine", async () => {
  const box = sandbox();
  await initialised(box);
  const inside = join(box.worktreesRoot, "github.com", "acme", "widgets", "fix", "1-x");
  mkdirSync(join(inside, ".."), { recursive: true });
  git(box.root, "worktree", "add", "-q", "-b", "fix/1-x", inside);
  assert.equal((await doctor(box, fakeGh().gh)).code, 0);
  const outside = join(mkdtempSync(join(tmpdir(), "gdm-doctor-out-")), "legacy-wt");
  git(box.root, "worktree", "add", "-q", "-b", "old", outside);
  const result = await doctor(box, fakeGh().gh);
  assert.equal(result.code, 1);
  assert.match(result.out, new RegExp(`^error: worktree outside ${box.worktreesRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .*legacy-wt \\(legacy-location\\)`, "m"));
  assert.doesNotMatch(result.out, /1-x/);
});

test("client-native isolation worktrees under .claude/worktrees are not flagged", async () => {
  const box = sandbox();
  await initialised(box);
  const native = join(box.root, ".claude", "worktrees", "agent-1");
  mkdirSync(join(native, ".."), { recursive: true });
  git(box.root, "worktree", "add", "-q", "-b", "agent-1", native);
  assert.equal((await doctor(box, fakeGh().gh)).code, 0);
});

test("worktree checks are skipped when the worktrees feature is off", async () => {
  const box = sandbox();
  await initialised(box, { features: { worktrees: false } });
  mkdirSync(join(box.home, ".claude"));
  assert.equal((await doctor(box, fakeGh().gh)).out, "doctor: ok\n");
});
