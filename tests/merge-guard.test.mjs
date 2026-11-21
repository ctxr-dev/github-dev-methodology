import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import mergeGuard, { createMergeGuardHandler } from "../plugins/github-dev-methodology/omp/merge-guard.js";
import { SKILL_DIR } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/session-context.mjs";

function optedInRepo(merge) {
  const root = mkdtempSync(join(tmpdir(), "gdm-omp-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  const config = JSON.parse(readFileSync(join(SKILL_DIR, "assets", "config.template.json"), "utf8"));
  config.projects["my-project"].merge = merge;
  mkdirSync(join(root, ".github-dev-methodology"));
  writeFileSync(join(root, ".github-dev-methodology", "config.json"), JSON.stringify(config));
  return root;
}

const bashEvent = (command) => ({ toolName: "bash", input: { command } });

function decide({ authority, scopes, predicateReady }) {
  if (authority === "human") return { decision: "deny", reason: "merge authority is human", exitCode: 4 };
  if (!predicateReady) return { decision: "deny", reason: "pr is not ready", exitCode: 3 };
  if (authority === "autonomous") return { decision: "allow", reason: "ok", exitCode: 0 };
  return { decision: "ask", reason: "needs explicit owner instruction in this session", exitCode: 4 };
}

function deps(overrides = {}) {
  return {
    gh: {},
    decideMerge: decide,
    parsePrRef: (text) => ({ owner: "o", repo: "r", number: Number.parseInt(text, 10) }),
    evaluatePr: async () => ({ ready: true, author: "a", headSha: "h", reviewers: [], ci: "success", reasons: [] }),
    ...overrides,
  };
}

test("blocks gh pr merge when authority is human", async () => {
  const cwd = optedInRepo({ authority: "human", scopes: [] });
  const result = await createMergeGuardHandler(deps())(bashEvent("gh pr merge 5"), { cwd, hasUI: true });
  assert.deepEqual(result, { block: true, reason: "merge authority is human" });
});

test("ignores non-bash tools, non-merge commands and repos without config", async () => {
  const handler = createMergeGuardHandler(deps());
  const cwd = optedInRepo({ authority: "human", scopes: [] });
  assert.equal(await handler({ toolName: "read", input: { command: "gh pr merge 5" } }, { cwd }), undefined);
  assert.equal(await handler(bashEvent("gh pr view 5"), { cwd }), undefined);
  assert.equal(await handler({ toolName: "bash", input: {} }, { cwd }), undefined);
  const bare = mkdtempSync(join(tmpdir(), "gdm-omp-bare-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: bare });
  assert.equal(await handler(bashEvent("gh pr merge 5"), { cwd: bare }), undefined);
});

test("allows a merge the authority permits", async () => {
  const cwd = optedInRepo({ authority: "autonomous", scopes: [] });
  assert.equal(await createMergeGuardHandler(deps())(bashEvent("gh pr merge 5"), { cwd }), undefined);
});

test("ask confirms with the owner when a UI exists", async () => {
  const cwd = optedInRepo({ authority: "scoped", scopes: ["session-instruction"] });
  const prompts = [];
  const ui = { confirm: async (title, reason) => (prompts.push([title, reason]), true) };
  const handler = createMergeGuardHandler(deps());
  assert.equal(await handler(bashEvent("gh pr merge 5"), { cwd, hasUI: true, ui }), undefined);
  assert.deepEqual(prompts, [["Merge requires owner approval", "needs explicit owner instruction in this session"]]);
  const declined = { confirm: async () => false };
  assert.deepEqual(await handler(bashEvent("gh pr merge 5"), { cwd, hasUI: true, ui: declined }), {
    block: true,
    reason: "owner declined merge",
  });
});

test("ask blocks with the reason when there is no UI", async () => {
  const cwd = optedInRepo({ authority: "scoped", scopes: ["session-instruction"] });
  const result = await createMergeGuardHandler(deps())(bashEvent("gh pr merge 5"), { cwd, hasUI: false });
  assert.deepEqual(result, { block: true, reason: "needs explicit owner instruction in this session" });
});

test("a thrown error blocks with the error text", async () => {
  const cwd = optedInRepo({ authority: "autonomous", scopes: [] });
  const evaluatePr = async () => {
    throw new Error("gh exploded");
  };
  const result = await createMergeGuardHandler(deps({ evaluatePr }))(bashEvent("gh pr merge 5"), { cwd });
  assert.deepEqual(result, { block: true, reason: "gh exploded" });
});

test("falls back to process.cwd() when the context has no cwd", async () => {
  const handler = createMergeGuardHandler(deps());
  assert.equal(await handler(bashEvent("gh pr view 1"), {}), undefined);
});

test("the default export registers a tool_call handler", () => {
  const registered = [];
  mergeGuard({ on: (name, handler) => registered.push([name, typeof handler]) });
  assert.deepEqual(registered, [["tool_call", "function"]]);
});
