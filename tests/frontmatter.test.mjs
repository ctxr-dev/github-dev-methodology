import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseFrontmatter } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/frontmatter.mjs";

test("parses scalars, nested maps and inline lists", () => {
  const { data, body } = parseFrontmatter(
    ["---", "feature: pr_loop", "requires:", "  features: [issue_schema, plan_to_issues]", "  config: []", "---", "", "# Title"].join("\n"),
  );
  assert.deepEqual(data, { feature: "pr_loop", requires: { features: ["issue_schema", "plan_to_issues"], config: [] } });
  assert.equal(body.trim(), "# Title");
});

test("parses the SKILL.md style: quoted strings, nested metadata map and inline map", () => {
  const nested = parseFrontmatter(["---", "name: github-dev-methodology", 'description: "A: b, c"', "metadata:", "  version: 1.0.0", "---"].join("\n"));
  assert.deepEqual(nested.data, { name: "github-dev-methodology", description: "A: b, c", metadata: { version: "1.0.0" } });
  const inline = parseFrontmatter("---\nmetadata: {version: 1.0.0}\n---\n");
  assert.deepEqual(inline.data, { metadata: { version: "1.0.0" } });
});

test("parses booleans, null, numbers and block lists", () => {
  const { data } = parseFrontmatter(["---", "a: true", "b: false", "c: null", "d: 3", "e:", "  - x", "  - y", "---"].join("\n"));
  assert.deepEqual(data, { a: true, b: false, c: null, d: 3, e: ["x", "y"] });
});

test("markdown without frontmatter returns empty data and the whole body", () => {
  assert.deepEqual(parseFrontmatter("# Just text\n"), { data: {}, body: "# Just text\n" });
});

test("an unclosed frontmatter block throws", () => {
  assert.throws(() => parseFrontmatter("---\nfeature: x\n"), /not closed/);
});

test("parses the frontmatter of the real pr-loop reference", () => {
  const source = readFileSync(new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/references/pr-loop.md", import.meta.url), "utf8");
  const { data, body } = parseFrontmatter(source);
  assert.equal(data.feature, "pr_loop");
  assert.deepEqual(data.requires.features, []);
  assert.deepEqual(data.requires.config, ["primary_repo"]);
  assert.match(body, /^\s*# PR review loop/);
});
