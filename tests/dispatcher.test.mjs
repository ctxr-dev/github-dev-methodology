import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";

const gdmFile = fileURLToPath(new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs", import.meta.url));

function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) }, out, err };
}

function commandsDirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "gdm-commands-"));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

const echoCommand = "export async function run(args, ctx) { ctx.stdout.write(JSON.stringify({ args, cwd: ctx.cwd, json: ctx.json }) + '\\n'); return 4; }";

test("unknown command prints usage on stderr and exits 64", async () => {
  const io = capture();
  const code = await main(["nope", "thing"], { ...io, commandsDir: commandsDirWith({}) });
  assert.equal(code, 64);
  assert.match(io.err.join(""), /unknown command: nope thing/);
  assert.match(io.err.join(""), /usage: gdm/);
});

test("a group/command argv runs commands/<group>-<command>.mjs and returns its exit code", async () => {
  const commandsDir = commandsDirWith({ "demo-echo.mjs": echoCommand });
  const io = capture();
  const code = await main(["--cwd", "/tmp", "demo", "echo", "a", "--json"], { ...io, commandsDir });
  assert.equal(code, 4);
  assert.deepEqual(JSON.parse(io.out.join("")), { args: ["a", "--json"], cwd: "/tmp", json: true });
});

test("single-word commands map to commands/<name>.mjs", async () => {
  const commandsDir = commandsDirWith({ "init.mjs": echoCommand });
  const io = capture();
  const code = await main(["init", "--preset", "full"], { ...io, commandsDir });
  assert.equal(code, 4);
  assert.deepEqual(JSON.parse(io.out.join("")).args, ["--preset", "full"]);
});

test("--cwd=<dir> form is accepted and a relative value resolves against the current cwd", async () => {
  const commandsDir = commandsDirWith({ "init.mjs": echoCommand });
  const io = capture();
  await main(["init", "--cwd=sub"], { ...io, commandsDir, cwd: "/base" });
  assert.equal(JSON.parse(io.out.join("")).cwd, "/base/sub");
});

test("no arguments and --help list every command discovered from file names", async () => {
  const commandsDir = commandsDirWith({ "pr-watch.mjs": "", "hook-session-start.mjs": "", "doctor.mjs": "", "notes.txt": "" });
  for (const argv of [[], ["--help"]]) {
    const io = capture();
    assert.equal(await main(argv, { ...io, commandsDir }), 0);
    const text = io.out.join("");
    for (const line of ["gdm pr watch", "gdm hook session-start", "gdm doctor"]) assert.ok(text.includes(line), line);
    assert.ok(!text.includes("notes"));
  }
});

const errorsModuleUrl = new URL("../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/errors.mjs", import.meta.url).href;

test("a thrown known error prints its message and exits 1; UsageError exits 64", async () => {
  const commandsDir = commandsDirWith({
    "demo-fail.mjs": `import { ConfigMissingError } from "${errorsModuleUrl}"; export async function run() { throw new ConfigMissingError(); }`,
    "demo-usage.mjs": `import { UsageError } from "${errorsModuleUrl}"; export async function run() { throw new UsageError("bad flag"); }`,
  });
  const failing = capture();
  assert.equal(await main(["demo", "fail"], { ...failing, commandsDir }), 1);
  assert.match(failing.err.join(""), /no \.github-dev-methodology\/config\.json found; run: gdm init/);
  const misused = capture();
  assert.equal(await main(["demo", "usage"], { ...misused, commandsDir }), 64);
  assert.match(misused.err.join(""), /bad flag/);
});

test("a command that does not return an integer exit code fails loudly", async () => {
  const commandsDir = commandsDirWith({ "demo-void.mjs": "export async function run() {}" });
  const io = capture();
  assert.equal(await main(["demo", "void"], { ...io, commandsDir }), 1);
  assert.match(io.err.join(""), /did not return an integer exit code/);
});

test("path-like command tokens are rejected as unknown", async () => {
  const io = capture();
  assert.equal(await main(["../etc", "passwd"], { ...io, commandsDir: commandsDirWith({}) }), 64);
});

test("executed directly, the script exits 64 for an unknown command", () => {
  assert.throws(
    () => execFileSync(process.execPath, [gdmFile, "definitely", "unknown"], { stdio: "pipe" }),
    (error) => error.status === 64 && /unknown command/.test(error.stderr.toString()),
  );
});
