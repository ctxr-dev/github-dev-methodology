# Installation

github-dev-methodology is one plugin, `github-dev-methodology@gdm`, published to three plugin systems: Claude Code, OpenAI Codex CLI and OMP. Each client keeps the plugin code in its own plugin cache. Your data lives in `~/.github-dev-methodology/`. A repo only carries `.github-dev-methodology/` and one block in `AGENTS.md`. See [`configuration.md`](configuration.md) for the layout.

Requirements: Node 20 or newer, `git`, and the GitHub CLI `gh`, logged in.

## Install the plugin

### Claude Code

```sh
claude plugin marketplace add ctxr-dev/github-dev-methodology#v1.0.1
claude plugin install github-dev-methodology@gdm
```

This installs at user scope. To update, add the marketplace again at the new tag, then update the plugin:

```sh
claude plugin marketplace add ctxr-dev/github-dev-methodology#<new-tag>
claude plugin update github-dev-methodology@gdm
```

To remove: `claude plugin uninstall github-dev-methodology@gdm`.

Auto-update for third-party marketplaces is off by default. Keep it off, so a new release reaches you only when you ask for it.

### OMP

```sh
omp plugin marketplace add ctxr-dev/github-dev-methodology
omp plugin install github-dev-methodology@gdm
```

Update with `omp plugin upgrade github-dev-methodology@gdm`. Remove with `omp plugin uninstall github-dev-methodology@gdm`. Restart the OMP session after install or upgrade, because extensions load at startup.

OMP can also load plugins from Claude's registry when its `claude-plugins` provider is on. Install in OMP's own registry anyway: the always-on rule and the merge-guard extension load only from there. OMP removes duplicate skill names.

### Codex

```sh
codex plugin marketplace add ctxr-dev/github-dev-methodology --ref v1.0.1
codex plugin add github-dev-methodology@gdm
```

Then open `/hooks` once and trust the plugin hooks. Codex skips untrusted plugin hooks. After every update that changes a hook script, trust the hooks again.

To update, run `codex plugin marketplace upgrade`, then add the plugin again. To remove: `codex plugin remove github-dev-methodology@gdm`.

### Other clients (skill only)

```sh
npx skills add ctxr-dev/github-dev-methodology -g --skill github-dev-methodology -y
```

This installs the skill only. There are no hooks and no rules. The repo's `AGENTS.md` block is the only pointer to it.

## What each client gets

| Client | Skill | Session context or rule | Merge guard |
|---|---|---|---|
| Claude Code | Yes | `SessionStart` hook adds context in opted-in repos | `PreToolUse` hook: deny or ask (the owner gets a native prompt) |
| Codex | Yes | `SessionStart` hook adds context in opted-in repos | `PreToolUse` hook: deny only, and it fails open (after `/hooks` trust) |
| OMP | Yes | Always-on rule | Extension: deny or confirm |
| Clients using `npx skills` | Yes | The repo `AGENTS.md` pointer only | None |

Codex merge protection is best effort. Codex does not support the `ask` decision, so an ask becomes a deny. Codex also lets the command run if the hook fails, times out or prints malformed output. On Codex, always run `gdm pr can-merge <pr>` before merging.

In a repo without `.github-dev-methodology/config.json`, none of the hooks, rules or extensions add context or block anything.

## Set up a repo

Run once per repo, from the repo root. The agent asks the owner for the values, then runs:

```sh
gdm init --preset <pr-only|single-issue|full> --org <org> --repo <repo>
gdm doctor
```

`gdm init` creates `.github-dev-methodology/config.json`, `.github-dev-methodology/.gitignore`, and the methodology block in `AGENTS.md`. Running it again changes nothing. It touches no other file. `gdm doctor` lists what still needs fixing. See [`SKILL.md`](../SKILL.md) for how to run `gdm`.

Commit `.github-dev-methodology/config.json` and the `AGENTS.md` change in a normal PR. Personal overrides go in `.github-dev-methodology/config.local.json`, which stays gitignored.

## GitHub CLI authentication

Request only the scopes the enabled features need:

| Features on | Scopes |
|---|---|
| `pr_loop`, `issue_schema`, `issue_lifecycle` | `repo` |
| `plan_to_issues`, `parallel_validation`, `cold_start`, `plan_deprecation` | `project`, `read:org` |

```sh
gh auth refresh -h github.com -s repo,project,read:org
```

`label_taxonomy` needs `admin:org` only if you let the agent create native Issue Types in the org (see [`label-taxonomy.md`](label-taxonomy.md)). Skip that branch if you are not an org admin. `gdm doctor` checks the scopes.

## Optional: the mcp-github server

The MCP server [`mcp-github`](https://github.com/ctxr-dev/mcp-github) offers the tools `gh.pr_review_watch` and `gh.pr_request_reviews`. It is optional. `gdm` does the same work and is the primary interface. If you install the server, set `MCP_GITHUB_DENY_TOOLS=gh.pr_merge` so the agent cannot call the merge tool.

## Migrate from the v0 layout

Version 0 was a git clone under `.agents/ctxr-dev/github-dev-methodology/` with a markdown config. Convert the config, then remove the clone. See "Migration from v0" in [`configuration.md`](configuration.md).
