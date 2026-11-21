# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-21

### Fixed

- `gdm worktrees prune` no longer removes worktrees that belong to other agents or other projects, and never touches client-managed worktrees (`<repo>/.claude/worktrees`, `~/.codex/worktrees`, `~/.omp/wt`). It now needs explicit targets or `--all-merged`.

### Added

- Worktree lease: `gdm worktrees add` records the owner under `~/.github-dev-methodology/state/` and takes a `git worktree lock` with the reason `gdm: owner=<owner> created=<iso>`. New flag `--owner`.
- `gdm worktrees release [<path|branch>]` drops the lease and never unlocks a lock held by another tool.
- `gdm worktrees prune --all-merged` for owner cleanup. It considers only released, gdm-owned worktrees inside the worktree root.
- `gdm worktrees prune` deletes the owner record and empty parent directories after a removal.
- `gdm worktrees census` reports `owner`, `lock`, `lock_age_seconds` and the `gdm-owned` flag.

## [1.0.0] - 2026-11-21

### Changed

- **Breaking: plugin layout.** The repo is now one plugin, `github-dev-methodology@gdm`, published to Claude Code, OpenAI Codex CLI and OMP. Skills install through each client's plugin system. `npx skills add` stays as a skill-only fallback. The v0 install, a git clone under `.agents/ctxr-dev/github-dev-methodology/`, is gone. Topic docs moved to `skills/github-dev-methodology/references/`, and the entry point is now `SKILL.md`.
- **Breaking: config format and location.** Settings are JSON, schema version 1, in `<repo>/.github-dev-methodology/config.json`, with gitignored personal overrides in `config.local.json`. The v0 markdown config is replaced. Convert it with `gdm config migrate`.
- **Breaking: worktree location.** Branch worktrees live under `~/.github-dev-methodology/worktrees/<host>/<owner>/<repo>/<branch>`, not next to the repo or inside it.
- The PR loop, issue schema, label taxonomy, plan-to-issues, cold start, agents orchestration and the other topic docs were rewritten around `gdm` commands and native GitHub metadata (sub-issues, issue dependencies, issue types, issue fields).
- A repo now carries only `.github-dev-methodology/` and one marked block in `AGENTS.md`.

### Added

- `gdm`, a zero-dependency Node CLI: `pr watch`, `pr request-reviews`, `pr threads`, `pr can-merge`, `validate tree`, `validate issues`, `validate labels`, `validate release`, `plan sync`, `worktrees add`, `worktrees census`, `worktrees prune`, `init`, `doctor`, `config get`, `config features`, `config migrate`, `hook session-start`, `hook pre-tool-use`.
- Merge authority (`human`, `scoped`, `autonomous`) with merge-guard hooks for Claude Code and Codex and an extension for OMP. New installs default to `human`.
- Lanes 0, 1 and 2 to pick the lightest workflow that fits the work.
- Feature flags `worktrees` and `stacked_prs` (15 flags in total), and `stacked_prs` support through `gh stack`.
- PR watch modes `foreground` and `wakeup`, CI-only mode, and a timeout for bot reviewers that never review.
- Session context injection for Claude Code and Codex, and an always-on rule for OMP.
- Tests on `node:test`, CI on Node 20 and 22, and tagged releases.

### Removed

- All v0 Node scripts and their npm dependencies, replaced by `gdm`.
- The v0 markdown config template, replaced by `assets/config.template.json` and `assets/config.schema.json`.
- The config keys `default_reviewer`, `default_dev_loop_mode`, `pr_loop_wait_for` and `polling_paradigm`.

### Fixed

- `pr watch` waits up to `review.max_hours` by default. The v0 script did not wait.
- Tree validation reads all pages of sub-issues, counts depth correctly, and fails on depth, orphans, cycles and parent and child asymmetry.

[Unreleased]: https://github.com/ctxr-dev/github-dev-methodology/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ctxr-dev/github-dev-methodology/releases/tag/v1.0.0
