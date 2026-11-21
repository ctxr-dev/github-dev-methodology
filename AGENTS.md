# AGENTS.md

This repository is **github-dev-methodology**: one plugin for Claude Code, OpenAI Codex CLI and OMP. It holds a skill (the methodology), a zero-dependency CLI `gdm`, and merge-guard hooks. This file is for agents working on this repository. To use the methodology in another repo, read [README.md](README.md).

## Layout

```
.claude-plugin/marketplace.json         Claude Code and OMP catalog (npx skills reads it too)
.agents/plugins/marketplace.json        Codex catalog
plugins/github-dev-methodology/
  .claude-plugin/plugin.json            Claude Code manifest
  .codex-plugin/plugin.json             Codex manifest
  package.json                          OMP extension manifest
  hooks/hooks.json, codex-hooks.json    Claude Code and Codex hooks
  omp/merge-guard.js                    OMP merge-guard extension
  rules/github-dev-methodology.md       OMP always-on rule
  skills/github-dev-methodology/
    SKILL.md                            entry point for agents that use the methodology
    references/                         topic docs, one per feature flag
    scripts/gdm.mjs                     dispatcher
    scripts/commands/<group>-<command>.mjs   one module per command
    scripts/lib/                        shared modules
    assets/                             schema, templates, labels, session context
tests/                                  node:test files and fixtures
.github/workflows/                      ci.yml and release.yml
```

The dispatcher maps a group and a command (for example `pr watch`) to `commands/pr-watch.mjs` by file name, and the single-word commands `init` and `doctor` to `commands/init.mjs` and `commands/doctor.mjs`. To add a command, add one file that exports `async function run(args, ctx)` and returns an exit code. There is no registry to edit.

## Conventions

- All repo content is in English. Docs use plain, simple English.
- Zero npm dependencies. Node 20 or newer, ESM (`.mjs`), `node:` built-ins only.
- No code comments. Use clear names and small functions.
- No source file over 300 lines. Split into `lib` modules.
- TDD: write the failing test first. Tests use `node:test` and `node:assert/strict`. No test touches the network or real GitHub; inject the fake runner of `createGh(runner)`. Tests that touch the home layout set `GDM_HOME` to a temp directory.
- Conventional commits. Work on a branch, open a PR, never commit to `main`. The implementer does not merge methodology PRs; the owner merges.

## Version invariant

These must carry the same version: root `package.json`, `plugins/github-dev-methodology/package.json`, both plugin manifests, and `metadata.version` in `SKILL.md`. Neither marketplace file has a `version` key. `gdm validate release` enforces this.

## Adding or changing a feature flag

Change all of these together: the `FLAGS` list in `lib/features.mjs`, `assets/config.schema.json`, `assets/config.template.json`, the flag table in `references/configuration.md`, and the `feature` value in the reference file's frontmatter. `gdm validate release` fails when they disagree.

## Before every PR

```sh
npm test && npm run check
```

Update [CHANGELOG.md](CHANGELOG.md) for any user-visible change. A release is a tag `v<version>`; the release workflow fails unless the tag equals the version invariant.
