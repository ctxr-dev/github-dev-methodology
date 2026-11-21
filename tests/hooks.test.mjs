import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { FLAGS } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/features.mjs";
import { matchMerge } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/merge-patterns.mjs";
import { renderSessionContext, SKILL_DIR } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/session-context.mjs";

const templatePath = join(SKILL_DIR, "assets", "config.template.json");
const CODEX_SUFFIX = " Codex hooks cannot prompt: the owner merges this PR or grants scope in config.";

function tempRepo({ merge, preset = "pr-only", raw } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gdm-hooks-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  if (merge || raw !== undefined) {
    const config = JSON.parse(readFileSync(templatePath, "utf8"));
    config.projects["my-project"].preset = preset;
    if (merge) config.projects["my-project"].merge = merge;
    mkdirSync(join(root, ".github-dev-methodology"));
    writeFileSync(join(root, ".github-dev-methodology", "config.json"), raw ?? JSON.stringify(config));
  }
  return root;
}

function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) }, out, err };
}

async function runHook(name, client, payload, extra = {}) {
  const io = capture();
  const code = await main(["hook", name, "--client", client], { ...io, stdin: JSON.stringify(payload), ...extra });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

const fakeParsePrRef = (text, defaults) => {
  const match = /^(?:https:\/\/github\.com\/)?(?:([^/#]+)\/([^/#]+)(?:#|\/pull\/))?(\d+)$/.exec(text);
  if (!match) throw new Error(`bad ref ${text}`);
  return { owner: match[1] ?? defaults.owner, repo: match[2] ?? defaults.repo, number: Number(match[3]) };
};

function fakeDecideMerge({ authority, scopes, predicateReady, prAuthor }) {
  if (authority === "human") return { decision: "deny", reason: "merge authority is human", exitCode: 4 };
  if (!predicateReady) return { decision: "deny", reason: "pr is not ready", exitCode: 3 };
  if (authority === "autonomous") return { decision: "allow", reason: "autonomous", exitCode: 0 };
  if (scopes.includes("dependabot-green") && prAuthor === "dependabot[bot]") return { decision: "allow", reason: "bot", exitCode: 0 };
  if (scopes.includes("session-instruction")) return { decision: "ask", reason: "needs explicit owner instruction in this session", exitCode: 4 };
  return { decision: "deny", reason: "out of scope", exitCode: 4 };
}

function guardDeps(overrides = {}) {
  return {
    parsePrRef: fakeParsePrRef,
    decideMerge: fakeDecideMerge,
    evaluatePr: async () => ({ ready: true, author: "human-dev", headSha: "abc", reviewers: [], ci: "success", reasons: [] }),
    ...overrides,
  };
}

const mergePayload = (cwd, command = "gh pr merge 5 --squash") => ({ cwd, tool_input: { command } });

test("session-start prints nothing outside an opted-in repo and exits 0", async () => {
  const result = await runHook("session-start", "claude", { cwd: tempRepo() });
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("session-start prints valid hook JSON with rendered context inside an opted-in repo", async () => {
  const root = tempRepo({ merge: { authority: "human", scopes: [] } });
  for (const client of ["claude", "codex"]) {
    const result = await runHook("session-start", client, { cwd: root });
    assert.equal(result.code, 0);
    const { hookSpecificOutput } = JSON.parse(result.stdout);
    assert.equal(hookSpecificOutput.hookEventName, "SessionStart");
    const text = hookSpecificOutput.additionalContext;
    assert.ok(text.includes(join(SKILL_DIR, "SKILL.md")));
    assert.ok(text.includes(join(root, ".github-dev-methodology", "config.json")));
    assert.match(text, /Active features: pr_loop, copilot_review/);
    assert.doesNotMatch(text, /\{\{/);
  }
});

test("session-start resolves the repo root from a subdirectory cwd", async () => {
  const root = tempRepo({ merge: { authority: "human", scopes: [] } });
  mkdirSync(join(root, "src"));
  const result = await runHook("session-start", "claude", { cwd: join(root, "src") });
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.includes("Active features"));
});

test("session-start with invalid config prints nothing, reports on stderr and exits 0", async () => {
  const result = await runHook("session-start", "codex", { cwd: tempRepo({ raw: "{broken" }) });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /session-start/);
});

test("session-start rejects a missing or unknown --client with exit 64", async () => {
  const io = capture();
  assert.equal(await main(["hook", "session-start"], { ...io, stdin: "{}" }), 64);
  assert.equal(await main(["hook", "session-start", "--client", "vim"], { ...io, stdin: "{}" }), 64);
});

test("rendered context stays within 8000 characters with every flag on", () => {
  const flags = Object.fromEntries(FLAGS.map((flag) => [flag, true]));
  const text = renderSessionContext(SKILL_DIR, flags, "/some/repo/.github-dev-methodology/config.json");
  assert.ok(text.length <= 8000, `rendered ${text.length} characters`);
  for (const flag of FLAGS) assert.ok(text.includes(flag));
});

test("pre-tool-use ignores commands that are not merges", async () => {
  const root = tempRepo({ merge: { authority: "human", scopes: [] } });
  const result = await runHook("pre-tool-use", "claude", mergePayload(root, "gh pr view 5"), guardDeps());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("pre-tool-use ignores merges in a repo without config", async () => {
  const result = await runHook("pre-tool-use", "claude", mergePayload(tempRepo()), guardDeps());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("pre-tool-use ignores payloads without a shell command or with unreadable input", async () => {
  const noCommand = await runHook("pre-tool-use", "claude", { cwd: "/tmp", tool_input: {} }, guardDeps());
  assert.equal(noCommand.stdout, "");
  const io = capture();
  const code = await main(["hook", "pre-tool-use", "--client", "codex"], { ...io, stdin: "not json" });
  assert.equal(code, 0);
  assert.equal(io.out.join(""), "");
  assert.match(io.err.join(""), /unreadable hook input/);
});

test("claude with authority human denies a merge without calling gh", async () => {
  const root = tempRepo({ merge: { authority: "human", scopes: [] } });
  const boom = async () => {
    throw new Error("must not be called");
  };
  const result = await runHook("pre-tool-use", "claude", mergePayload(root), guardDeps({ evaluatePr: boom, gh: { cli: boom } }));
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "merge authority is human" },
  });
});

test("claude scoped with session-instruction asks the owner", async () => {
  const root = tempRepo({ merge: { authority: "scoped", scopes: ["session-instruction"] } });
  const result = await runHook("pre-tool-use", "claude", mergePayload(root), guardDeps());
  const { hookSpecificOutput } = JSON.parse(result.stdout);
  assert.equal(hookSpecificOutput.permissionDecision, "ask");
  assert.equal(hookSpecificOutput.permissionDecisionReason, "needs explicit owner instruction in this session");
});

test("codex turns ask into deny with the cannot-prompt suffix", async () => {
  const root = tempRepo({ merge: { authority: "scoped", scopes: ["session-instruction"] } });
  const result = await runHook("pre-tool-use", "codex", mergePayload(root), guardDeps());
  const { hookSpecificOutput } = JSON.parse(result.stdout);
  assert.equal(hookSpecificOutput.permissionDecision, "deny");
  assert.equal(hookSpecificOutput.permissionDecisionReason, `needs explicit owner instruction in this session${CODEX_SUFFIX}`);
});

test("codex deny passes through without the suffix", async () => {
  const root = tempRepo({ merge: { authority: "human", scopes: [] } });
  const result = await runHook("pre-tool-use", "codex", mergePayload(root), guardDeps());
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, "merge authority is human");
});

test("an allowed merge prints nothing", async () => {
  const root = tempRepo({ merge: { authority: "autonomous", scopes: [] } });
  const result = await runHook("pre-tool-use", "claude", mergePayload(root), guardDeps());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("a not-ready pull request is denied with exit 0 and the predicate input is forwarded", async () => {
  const root = tempRepo({ merge: { authority: "autonomous", scopes: [] } });
  const seen = [];
  const evaluatePr = async (gh, ref) => {
    seen.push(ref);
    return { ready: false, author: "x", headSha: "a", reviewers: [], ci: "pending", reasons: ["ci pending"] };
  };
  const result = await runHook("pre-tool-use", "claude", mergePayload(root, "gh pr merge ctxr-dev/demo#9"), guardDeps({ evaluatePr }));
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(seen, [{ owner: "ctxr-dev", repo: "demo", number: 9 }]);
});

test("internal errors map to ask for claude and deny for codex with the error text", async () => {
  const root = tempRepo({ merge: { authority: "autonomous", scopes: [] } });
  const evaluatePr = async () => {
    throw new Error("gh exploded");
  };
  const claude = await runHook("pre-tool-use", "claude", mergePayload(root), guardDeps({ evaluatePr }));
  const codex = await runHook("pre-tool-use", "codex", mergePayload(root), guardDeps({ evaluatePr }));
  const claudeOut = JSON.parse(claude.stdout).hookSpecificOutput;
  const codexOut = JSON.parse(codex.stdout).hookSpecificOutput;
  assert.equal(claudeOut.permissionDecision, "ask");
  assert.equal(codexOut.permissionDecision, "deny");
  assert.match(claudeOut.permissionDecisionReason, /gh exploded/);
  assert.equal(codexOut.permissionDecisionReason.includes("Codex hooks cannot prompt"), false);
  assert.equal(claude.code, 0);
  assert.equal(codex.code, 0);
});

test("invalid repo config on a merge command is an internal error", async () => {
  const result = await runHook("pre-tool-use", "codex", mergePayload(tempRepo({ raw: "{broken" })), guardDeps());
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("without a PR argument the current branch PR comes from gh pr view", async () => {
  const root = tempRepo({ merge: { authority: "autonomous", scopes: [] } });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: root });
  execFileSync("git", ["checkout", "-q", "-b", "fix/1-x"], { cwd: root });
  const calls = [];
  const gh = {
    cli: async (args) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify({ number: 7, url: "https://github.com/my-org/my-repo/pull/7" }), stderr: "" };
    },
  };
  const seen = [];
  const evaluatePr = async (_gh, ref) => {
    seen.push(ref);
    return { ready: true, author: "a", headSha: "h", reviewers: [], ci: "success", reasons: [] };
  };
  const result = await runHook("pre-tool-use", "claude", mergePayload(root, "gh pr merge --squash"), guardDeps({ gh, evaluatePr }));
  assert.equal(result.stdout, "");
  assert.deepEqual(calls, [["pr", "view", "fix/1-x", "--repo", "my-org/my-repo", "--json", "number,url"]]);
  assert.deepEqual(seen, [{ owner: "my-org", repo: "my-repo", number: 7 }]);
});

test("matchMerge recognises the three merge shapes and extracts the PR argument", () => {
  assert.deepEqual(matchMerge("gh pr merge 5"), { matched: true, prArg: "5" });
  assert.deepEqual(matchMerge("gh pr merge --squash --delete-branch 12 && echo done"), { matched: true, prArg: "12" });
  assert.deepEqual(matchMerge("gh pr merge https://github.com/o/r/pull/3 --auto"), { matched: true, prArg: "https://github.com/o/r/pull/3" });
  assert.deepEqual(matchMerge("gh pr merge -R o/r 4"), { matched: true, prArg: "o/r#4" });
  assert.deepEqual(matchMerge("gh pr merge --body 'fix it' 8"), { matched: true, prArg: "8" });
  assert.deepEqual(matchMerge("gh pr merge"), { matched: true, prArg: null });
  assert.deepEqual(matchMerge("cd x && gh stack merge"), { matched: true, prArg: null });
  assert.deepEqual(matchMerge("gh api -X PUT repos/o/r/pulls/9/merge"), { matched: true, prArg: "o/r#9" });
});

test("matchMerge ignores other gh commands and non-strings", () => {
  for (const command of ["gh pr view 5", "gh pr merged", "git merge main", "gh api repos/o/r/pulls/9", "", undefined]) {
    assert.equal(matchMerge(command).matched, false, String(command));
  }
});
