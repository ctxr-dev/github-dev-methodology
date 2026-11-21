import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/commands/validate-release.mjs";
import { capture } from "./helpers/fake-github.mjs";

const realRoot = fileURLToPath(new URL("..", import.meta.url));
const SKILL = "plugins/github-dev-methodology/skills/github-dev-methodology";

function copyOfRepo() {
  const root = mkdtempSync(join(tmpdir(), "gdm-release-"));
  for (const entry of [".claude-plugin", ".agents", "plugins", "package.json", "README.md", "AGENTS.md", "CHANGELOG.md", "LICENSE"]) {
    if (existsSync(join(realRoot, entry))) cpSync(join(realRoot, entry), join(root, entry), { recursive: true });
  }
  return root;
}

function edit(root, relativePath, transform) {
  const path = join(root, relativePath);
  writeFileSync(path, transform(readFileSync(path, "utf8")));
}

function editJson(root, relativePath, transform) {
  edit(root, relativePath, (text) => JSON.stringify(transform(JSON.parse(text)), null, 2));
}

async function release(cwd, args = []) {
  const io = capture();
  const code = await run(args, { ...io, cwd, json: args.includes("--json") });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

const baseline = async () => (await release(copyOfRepo())).stderr.split("\n").filter(Boolean);

async function newFailures(mutate) {
  const before = await baseline();
  const root = copyOfRepo();
  mutate(root);
  const after = await release(root);
  assert.equal(after.code, 1);
  return after.stderr.split("\n").filter((line) => line && !before.includes(line));
}

test("the real repo layout passes every release check", async () => {
  const { code, stdout, stderr } = await release(copyOfRepo());
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.equal(stdout, "release checks passed\n");
});

test("it finds the repo root by walking up from a subdirectory", async () => {
  const root = copyOfRepo();
  const { code } = await release(join(root, SKILL, "references"));
  assert.equal(code, (await release(root)).code);
});

test("outside a methodology repo it fails with a clear message", async () => {
  await assert.rejects(release(mkdtempSync(join(tmpdir(), "gdm-norelease-"))), /no \.claude-plugin\/marketplace\.json/);
});

test("changing only the codex manifest version fails and names the file", async () => {
  const failures = await newFailures((root) => editJson(root, "plugins/github-dev-methodology/.codex-plugin/plugin.json", (m) => ({ ...m, version: "1.0.1" })));
  assert.deepEqual(failures, [
    'release: version: plugins/github-dev-methodology/.codex-plugin/plugin.json is "1.0.1" but package.json is "1.0.0"',
  ]);
});

test("the SKILL.md metadata version takes part in the invariant", async () => {
  const failures = await newFailures((root) => edit(root, `${SKILL}/SKILL.md`, (t) => t.replace("version: 1.0.0", "version: 2.0.0")));
  assert.match(failures[0], /SKILL\.md metadata\.version is "2\.0\.0"/);
});

test("a version key in either marketplace file fails", async () => {
  const failures = await newFailures((root) => {
    editJson(root, ".claude-plugin/marketplace.json", (m) => ({ ...m, plugins: [{ ...m.plugins[0], version: "1.0.0" }] }));
    editJson(root, ".agents/plugins/marketplace.json", (m) => ({ ...m, version: "1.0.0" }));
  });
  assert.deepEqual(failures, [
    "release: marketplace-version: .claude-plugin/marketplace.json must not contain a version key (found plugins.0.version)",
    "release: marketplace-version: .agents/plugins/marketplace.json must not contain a version key (found version)",
  ]);
});

test("the marketplaces must name the plugin and its source path", async () => {
  const failures = await newFailures((root) => {
    editJson(root, ".claude-plugin/marketplace.json", (m) => ({ ...m, plugins: [{ ...m.plugins[0], source: "./elsewhere" }] }));
    editJson(root, ".agents/plugins/marketplace.json", (m) => ({ ...m, plugins: [{ ...m.plugins[0], name: "other" }] }));
  });
  assert.match(failures[0], /\.claude-plugin\/marketplace\.json plugin github-dev-methodology has source "\.\/elsewhere"/);
  assert.match(failures[1], /\.agents\/plugins\/marketplace\.json has no plugin named github-dev-methodology/);
});

test("a flag missing from the schema fails", async () => {
  const failures = await newFailures((root) =>
    editJson(root, `${SKILL}/assets/config.schema.json`, (schema) => {
      delete schema.$defs.project.properties.features.properties.worktrees;
      return schema;
    }),
  );
  assert.deepEqual(failures, ["release: flags-schema: assets/config.schema.json features lacks flag(s): worktrees"]);
});

test("a flag missing from the configuration.md table fails", async () => {
  const failures = await newFailures((root) =>
    edit(root, `${SKILL}/references/configuration.md`, (text) => text.split("\n").filter((line) => !line.startsWith("| `cold_start` |")).join("\n")),
  );
  assert.deepEqual(failures, ["release: flags-docs: references/configuration.md flag table lacks flag(s): cold_start"]);
});

test("an invalid template and an unknown template flag fail", async () => {
  const failures = await newFailures((root) =>
    editJson(root, `${SKILL}/assets/config.template.json`, (template) => {
      template.projects["my-project"].features = { made_up: true };
      return template;
    }),
  );
  assert.ok(failures.some((line) => line.startsWith("release: template: ") && line.includes("made_up")));
  assert.ok(failures.some((line) => line.includes("flags-template: assets/config.template.json features has unknown flag(s): made_up")));
});

test("a reference with an unknown feature or wrong requires fails", async () => {
  const failures = await newFailures((root) => {
    edit(root, `${SKILL}/references/commits.md`, (t) => t.replace("feature: conventional_commits", "feature: nonsense"));
    edit(root, `${SKILL}/references/cold-start.md`, (t) => t.replace("features: [issue_schema]", "features: []"));
  });
  assert.ok(failures.includes('release: references: references/commits.md has unknown feature "nonsense"'));
  assert.ok(failures.includes("release: references: references/cold-start.md requires.features is [], expected [issue_schema]"));
  assert.ok(failures.some((line) => line.includes("references/commits.md for flag conventional_commits")) === false);
});

test("SKILL.md at 500 lines fails", async () => {
  const failures = await newFailures((root) => edit(root, `${SKILL}/SKILL.md`, (t) => `${t.trimEnd()}\n${"filler\n".repeat(500)}`));
  assert.match(failures[0], /^release: skill-length: SKILL\.md has \d+ lines, the limit is 499$/);
});

test("an oversized rendered session context fails", async () => {
  const failures = await newFailures((root) => edit(root, `${SKILL}/assets/session-context.md`, (t) => `${t}\n${"x".repeat(8000)}`));
  assert.match(failures[0], /^release: session-context: rendered context is \d+ characters with all 15 flags on, the limit is 8000$/);
});

test("an unreplaced session-context placeholder fails", async () => {
  const failures = await newFailures((root) => edit(root, `${SKILL}/assets/session-context.md`, (t) => `${t}\n{{MYSTERY}}`));
  assert.deepEqual(failures, ["release: session-context: unreplaced placeholder(s): {{MYSTERY}}"]);
});

test("a broken relative link fails but links in code and absolute URLs do not", async () => {
  const failures = await newFailures((root) =>
    edit(root, "README.md", (t) => `${t}\n[gone](docs/gone.md) [web](https://example.com/x.md) \`[code](nope.md)\`\n\n\`\`\`\n[fenced](nope2.md)\n\`\`\`\n`),
  );
  assert.deepEqual(failures, ["release: links: README.md links to docs/gone.md, which does not exist"]);
});

test("a doc naming a command with no module fails", async () => {
  const failures = await newFailures((root) =>
    edit(root, "README.md", (t) => `${t}\nRun \`gdm frobnicate now\` and \`gdm pr bogus\`.\n\n\`\`\`bash\ngdm pr watch o/r#1\ngdm nonexistent thing\n\`\`\`\n`),
  );
  assert.deepEqual(failures, [
    'release: commands: README.md mentions "gdm frobnicate now" but no command module matches it',
    'release: commands: README.md mentions "gdm pr bogus" but no command module matches it',
    'release: commands: README.md mentions "gdm nonexistent thing" but no command module matches it',
  ]);
});

test("--json prints the failures as data", async () => {
  const root = copyOfRepo();
  editJson(root, "plugins/github-dev-methodology/.codex-plugin/plugin.json", (m) => ({ ...m, version: "9.9.9" }));
  const { code, stdout } = await release(root, ["--json"]);
  assert.equal(code, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.failures.some((failure) => failure.check === "version"));
});
