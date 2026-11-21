<div align="center">

# github-dev-methodology

### One workflow contract for AI agents that work through GitHub Issues, Projects and PRs

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
  <img alt="Node 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2020-43853d?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-lightgrey?style=for-the-badge">
</p>

<p>
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#set-up-a-repo"><strong>Set up a repo</strong></a> ·
  <a href="#whats-inside"><strong>What's inside</strong></a> ·
  <a href="#migrate-from-v0"><strong>Migrate from v0</strong></a> ·
  <a href="#development"><strong>Development</strong></a>
</p>

</div>

<br/>

AI coding agents drift. Different sessions, different agents and different people on one team need one durable contract for how work is shaped: how issues are written, how PRs reach merge, how plans become tracked work, and who may merge.

This repo is a plugin for Claude Code, OpenAI Codex CLI and OMP. It has a skill that holds the methodology, a small CLI called `gdm` that does the GitHub work in a deterministic way, and hooks that stop merges the owner has not allowed.

## What's inside

| Part | What it does |
|---|---|
| PR review loop | Watches a set of reviewers (Copilot and humans) and CI against an explicit exit predicate. CI-only mode and a timeout for silent bots. |
| Merge authority | `human`, `scoped` or `autonomous`. Hooks block merges the setting does not allow. |
| Lanes | Lane 0 for bot and docs PRs, Lane 1 for one issue, Lane 2 for plans and cross-repo work. |
| Issue schema | Native sub-issues, dependencies and issue types, plus a fixed body shape that `gdm validate issues` checks. |
| Plan to issues | `gdm plan sync` turns a manifest into a sub-issue tree. It is idempotent. |
| Worktrees and stacked PRs | One worktree per agent under `~/.github-dev-methodology/worktrees/`. Stacks for dependent PR chains. |
| Opt-in features | 15 flags and three presets: `pr-only`, `single-issue`, `full`. |
| `gdm` CLI | Node 20 or newer, no dependencies. |

## Install

The plugin is `github-dev-methodology@gdm`. The client keeps the plugin code in its own cache. Nothing is cloned into your repos.

**Claude Code**

```sh
claude plugin marketplace add ctxr-dev/github-dev-methodology#v1.0.0
claude plugin install github-dev-methodology@gdm
```

**OMP**

```sh
omp plugin marketplace add ctxr-dev/github-dev-methodology
omp plugin install github-dev-methodology@gdm
```

Restart the OMP session after install, because extensions load at startup.

**Codex**

```sh
codex plugin marketplace add ctxr-dev/github-dev-methodology --ref v1.0.0
codex plugin add github-dev-methodology@gdm
```

Then open `/hooks` once and trust the plugin hooks. Codex skips untrusted plugin hooks.

**Other clients (skill only, no hooks and no rules)**

```sh
npx skills add ctxr-dev/github-dev-methodology -g --skill github-dev-methodology -y
```

| Client | Skill | Session context or rule | Merge guard |
|---|---|---|---|
| Claude Code | Yes | `SessionStart` hook | `PreToolUse` hook: deny or ask |
| Codex | Yes | `SessionStart` hook | `PreToolUse` hook: deny only, fails open, needs `/hooks` trust |
| OMP | Yes | Always-on rule | Extension: deny or confirm |
| `npx skills` clients | Yes | Repo `AGENTS.md` pointer only | None |

Codex merge protection is best effort. Full details, including the GitHub token scopes: [installation.md](plugins/github-dev-methodology/skills/github-dev-methodology/references/installation.md).

## Set up a repo

Run once per repo, from the repo root. Your agent asks you for the preset, the org and the repo, then runs:

```sh
node <skill-dir>/scripts/gdm.mjs init --preset <pr-only|single-issue|full> --org <org> --repo <repo>
node <skill-dir>/scripts/gdm.mjs doctor
```

`<skill-dir>` is the folder of the `github-dev-methodology` skill in the client's plugin cache. In the docs, `gdm` means that full command.

`gdm init` creates `.github-dev-methodology/config.json`, `.github-dev-methodology/.gitignore` and one marked block in `AGENTS.md`. It changes nothing else, and running it again changes nothing. `gdm doctor` lists what is still missing. Commit the new files in a normal PR.

New installs use merge authority `human`: the agent never merges, and the hooks block it. Change `merge.authority` in the config if you want otherwise. See [configuration.md](plugins/github-dev-methodology/skills/github-dev-methodology/references/configuration.md).

## Update and uninstall

| Client | Update | Uninstall |
|---|---|---|
| Claude Code | Add the marketplace at the new tag, then `claude plugin update github-dev-methodology@gdm` | `claude plugin uninstall github-dev-methodology@gdm` |
| OMP | `omp plugin upgrade github-dev-methodology@gdm`, then restart the session | `omp plugin uninstall github-dev-methodology@gdm` |
| Codex | `codex plugin marketplace upgrade`, then add the plugin again | `codex plugin remove github-dev-methodology@gdm` |

Third-party marketplace auto-update is off by default in Claude Code. Keep it off.

## Migrate from v0

Version 0 was a git clone at `.agents/ctxr-dev/github-dev-methodology/` with a markdown config. To move a repo:

1. Install the plugin (above).
2. `gdm config migrate <old.config.local.md> --write` converts the config to `.github-dev-methodology/config.json`. Read stderr: every key that was not migrated is printed as `not migrated: <heading or key>`.
3. `gdm init` with the same preset, org and repo adds the `AGENTS.md` block.
4. Remove the old clone `.agents/ctxr-dev/github-dev-methodology/` when `git status` inside it is clean, and delete the old config file.
5. `gdm doctor` must exit 0.

The full steps and the key mapping are in the "Migration from v0" section of [configuration.md](plugins/github-dev-methodology/skills/github-dev-methodology/references/configuration.md).

## Where things live

```
~/.github-dev-methodology/
├── config.json                                   user config (optional)
├── worktrees/<host>/<owner>/<repo>/<branch>      branch worktrees
└── state/<host>/<owner>/<repo>/                  plan ledgers

<repo>/
├── AGENTS.md                                     one marked block
└── .github-dev-methodology/
    ├── config.json                               committed settings
    ├── config.local.json                         personal overrides (gitignored)
    └── .gitignore
```

A repo carries nothing else. There are no symlinks into repos, and the methodology does not edit the root `.gitignore`, `CLAUDE.md`, `.mcp.json` or `.claude/settings.json`.

## Development

Needs Node 20 or newer. There are no npm dependencies.

```sh
npm test
npm run check
```

`npm test` runs the unit tests. `npm run check` runs `gdm validate release`, which checks that docs, schema, template, hooks and versions agree. See [AGENTS.md](AGENTS.md) for the repo layout and rules. Release notes are in [CHANGELOG.md](CHANGELOG.md).

---

<div align="center">

Made by <a href="mailto:dmitri.meshin@gmail.com"><strong>Dmitri Meshin</strong></a>, distilled from real <a href="https://github.com/ctxr-dev">ctxr-dev</a> project work.

<sub>MIT licensed - see <a href="LICENSE">LICENSE</a>.</sub>

</div>
