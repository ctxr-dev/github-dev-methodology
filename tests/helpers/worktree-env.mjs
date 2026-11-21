import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/gdm.mjs";
import { createGh } from "../../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";
import { spawnGit } from "../../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/repo-identity.mjs";

const ORIGIN_URL = "https://github.com/acme/app.git";
const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

export function git(cwd, ...args) {
  return execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
}

export function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gdm-wt-")));
  const source = join(base, "src");
  mkdirSync(source);
  git(source, "init", "-q", "-b", "main");
  git(source, "commit", "-q", "--allow-empty", "-m", "initial");
  git(base, "clone", "-q", "--bare", source, "origin.git");
  git(base, "clone", "-q", join(base, "origin.git"), "checkout");
  const checkout = join(base, "checkout");
  git(checkout, "remote", "set-head", "origin", "-a");
  const home = join(base, "home");
  return { base, checkout, home, worktrees: join(home, "worktrees", "github.com", "acme", "app") };
}

function gitWithGithubOrigin(args, cwd) {
  if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
    return { status: 0, stdout: `${ORIGIN_URL}\n`, stderr: "" };
  }
  return spawnGit(args, cwd);
}

function fakeGh(stateByBranch = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    const branch = args[args.indexOf("--head") + 1];
    const state = stateByBranch[branch];
    return { status: 0, stdout: JSON.stringify(state ? [{ state }] : []), stderr: "" };
  };
  return { gh: createGh(runner), calls };
}

export async function gdm(env, argv, { ghStates = {}, cwd, now, wrapGit } = {}) {
  const out = [];
  const err = [];
  const { gh, calls } = fakeGh(ghStates);
  const code = await main(argv, {
    cwd: cwd ?? env.checkout,
    env: { ...process.env, GDM_HOME: env.home },
    git: wrapGit ? (args, dir) => wrapGit(args, dir, gitWithGithubOrigin) : gitWithGithubOrigin,
    gh,
    ...(now ? { now } : {}),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(""), err: err.join(""), calls };
}

export const lastLine = (text) => text.trim().split("\n").at(-1);
