import assert from "node:assert/strict";
import { test } from "node:test";
import { NoOriginError, NotGitRepoError, UnsupportedRemoteError } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs";
import { parseRemoteUrl, repoIdentity } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/repo-identity.mjs";

function fakeGit({ root = "/work/repo", remote } = {}) {
  return (args) => {
    if (args[0] === "rev-parse") return root ? { status: 0, stdout: root + "\n", stderr: "" } : { status: 128, stdout: "", stderr: "fatal" };
    if (args[0] === "remote") return remote ? { status: 0, stdout: remote + "\n", stderr: "" } : { status: 2, stdout: "", stderr: "no such remote" };
    throw new Error("unexpected git call");
  };
}

const expected = { host: "github.com", owner: "ctxr-dev", repo: "github-dev-methodology" };

test("parses the https remote form with and without .git", () => {
  assert.deepEqual(parseRemoteUrl("https://github.com/ctxr-dev/github-dev-methodology.git"), expected);
  assert.deepEqual(parseRemoteUrl("https://github.com/ctxr-dev/github-dev-methodology"), expected);
});

test("parses the scp-like remote form", () => {
  assert.deepEqual(parseRemoteUrl("git@github.com:ctxr-dev/github-dev-methodology.git"), expected);
});

test("parses the ssh:// remote form and lowercases the host", () => {
  assert.deepEqual(parseRemoteUrl("ssh://git@GitHub.com/ctxr-dev/github-dev-methodology.git"), expected);
  assert.deepEqual(parseRemoteUrl("ssh://git@github.com:22/ctxr-dev/github-dev-methodology"), expected);
});

test("rejects remotes that are not owner/repo", () => {
  assert.throws(() => parseRemoteUrl("https://github.com/only-owner"), UnsupportedRemoteError);
  assert.throws(() => parseRemoteUrl("/local/path/repo.git"), UnsupportedRemoteError);
});

test("repoIdentity returns root, host, owner and repo", () => {
  const id = repoIdentity("/work/repo/sub", fakeGit({ remote: "git@github.com:ctxr-dev/github-dev-methodology.git" }));
  assert.deepEqual(id, { root: "/work/repo", ...expected });
});

test("repoIdentity without origin throws NoOriginError with the contract message", () => {
  assert.throws(() => repoIdentity("/work/repo", fakeGit()), (error) => {
    assert.ok(error instanceof NoOriginError);
    assert.equal(error.message, "worktree and state commands need an origin remote");
    return true;
  });
});

test("repoIdentity outside a git repository throws NotGitRepoError", () => {
  assert.throws(() => repoIdentity("/tmp/none", fakeGit({ root: null })), NotGitRepoError);
});
