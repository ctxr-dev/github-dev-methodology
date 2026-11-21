import assert from "node:assert/strict";
import { test } from "node:test";
import { decideMerge } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/merge-authority.mjs";

const matrix = [
  { name: "human ready", input: { authority: "human", predicateReady: true, prAuthor: "dependabot" }, decision: "deny", exitCode: 4 },
  { name: "human not ready", input: { authority: "human", predicateReady: false, prAuthor: "x" }, decision: "deny", exitCode: 4 },
  { name: "autonomous not ready", input: { authority: "autonomous", predicateReady: false, prAuthor: "x" }, decision: "deny", exitCode: 3 },
  { name: "autonomous ready", input: { authority: "autonomous", predicateReady: true, prAuthor: "x" }, decision: "allow", exitCode: 0 },
  { name: "scoped not ready", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: false, prAuthor: "dependabot[bot]" }, decision: "deny", exitCode: 3 },
  { name: "scoped dependabot-green dependabot[bot]", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: true, prAuthor: "dependabot[bot]" }, decision: "allow", exitCode: 0 },
  { name: "scoped dependabot-green renovate[bot]", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: true, prAuthor: "renovate[bot]" }, decision: "allow", exitCode: 0 },
  { name: "scoped dependabot-green GraphQL bot login", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: true, prAuthor: "dependabot" }, decision: "allow", exitCode: 0 },
  { name: "scoped dependabot-green gh app login", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: true, prAuthor: "app/dependabot" }, decision: "allow", exitCode: 0 },
  { name: "scoped dependabot-green human author", input: { authority: "scoped", scopes: ["dependabot-green"], predicateReady: true, prAuthor: "alice" }, decision: "deny", exitCode: 4 },
  { name: "scoped session-instruction", input: { authority: "scoped", scopes: ["session-instruction"], predicateReady: true, prAuthor: "alice" }, decision: "ask", exitCode: 4 },
  { name: "scoped both scopes, bot author", input: { authority: "scoped", scopes: ["session-instruction", "dependabot-green"], predicateReady: true, prAuthor: "dependabot[bot]" }, decision: "allow", exitCode: 0 },
  { name: "scoped both scopes, human author", input: { authority: "scoped", scopes: ["dependabot-green", "session-instruction"], predicateReady: true, prAuthor: "alice" }, decision: "ask", exitCode: 4 },
  { name: "scoped empty scopes", input: { authority: "scoped", scopes: [], predicateReady: true, prAuthor: "dependabot[bot]" }, decision: "deny", exitCode: 4 },
  { name: "scoped omitted scopes", input: { authority: "scoped", predicateReady: true, prAuthor: "alice" }, decision: "deny", exitCode: 4 },
  { name: "unknown authority", input: { authority: "yolo", predicateReady: true, prAuthor: "alice" }, decision: "deny", exitCode: 4 },
];

for (const { name, input, decision, exitCode } of matrix) {
  test(`decideMerge: ${name}`, () => {
    const result = decideMerge(input);
    assert.equal(result.decision, decision);
    assert.equal(result.exitCode, exitCode);
    assert.equal(typeof result.reason, "string");
    assert.ok(result.reason.length > 0);
  });
}

test("decideMerge: ask reason tells the agent to wait for the owner", () => {
  const result = decideMerge({ authority: "scoped", scopes: ["session-instruction"], predicateReady: true, prAuthor: "alice" });
  assert.equal(result.reason, "needs explicit owner instruction in this session");
});
