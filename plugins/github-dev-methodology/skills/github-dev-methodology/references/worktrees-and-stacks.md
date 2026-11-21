---
feature: worktrees
requires:
  features: []
  config: []
---

# Worktrees and stacked PRs

One branch, one worktree, one agent. `gdm` means `node <skill-dir>/scripts/gdm.mjs`; see [`SKILL.md`](../SKILL.md).

## Where worktrees live

```
~/.github-dev-methodology/worktrees/<host>/<owner>/<repo>/<branch>
```

The root is `worktrees_root` in the user config (see [`configuration.md`](configuration.md)). A branch such as `fix/123-null` becomes nested directories: `.../<repo>/fix/123-null`. A worktree is never a sibling of the repo and never inside it. This keeps the repo folder clean, keeps editors and file watchers out of other branches, and puts all branch work under one root that can be listed and pruned.

Scope: this applies to branch worktrees created for methodology work. Transient isolation worktrees that a client creates by itself stay where the client puts them, and the client cleans them up:

- Claude Code (`--worktree`, subagent `isolation: worktree`): `<repo>/.claude/worktrees/`
- Codex app: `~/.codex/worktrees`
- OMP task isolation: `~/.omp/wt`

Never do branch work for a PR in those places.

## Commands

| Command | What it does |
|---|---|
| `gdm worktrees add <branch> [--base <ref>]` | Fetches `origin`, then creates the worktree and a new branch from `--base` (default `origin/<default branch>`). If the branch already exists, it checks that branch out in the new worktree. If the path exists, it exits 1 with `worktree path exists: <path>`. The last line of output is the absolute path. |
| `gdm worktrees census [--json]` | Lists every registered worktree with its branch, dirty state, PR state and last-commit age. Also reports directories under the worktree root that git does not know (`orphan-dir`) and registered worktrees outside the root (`legacy-location`). It reports only. It never deletes. |
| `gdm worktrees prune` | Removes a worktree only when it is clean and its PR is merged. Then it deletes the local branch with `git branch -d` (never `-D`) and runs `git worktree prune`. Prints what it removed and what it kept, with the reason. |

Never remove a dirty worktree. Never use `--force`.

## Working in a worktree

1. Create it: `gdm worktrees add <type>/<issue>-<slug>`.
2. Start the agent session with the worktree as its working directory. Then the committed `.github-dev-methodology/config.json`, `AGENTS.md` and the client's project config load from the worktree.
3. Run `gdm worktrees census` at the start of a session. Pick up or clean up what it lists before you create more.
4. After the PR is merged, run `gdm worktrees prune`.

One worktree per parallel agent. Two agents never share one worktree.

## Client access to the worktree root

The worktree root is outside the repo, so a client may ask permission for every edit there. `gdm doctor` prints the exact line to add. It never edits client files.

- **Claude Code:** edits outside the launch directory prompt, unless `permissions.additionalDirectories` in `~/.claude/settings.json` covers the worktree root. Alternatives: start Claude in the worktree, or pass `--add-dir`.
- **Codex:** in `workspace-write` mode, paths outside the workspace prompt, unless `sandbox_workspace_write.writable_roots` in `~/.codex/config.toml` covers the root. Alternative: `--add-dir`. The git directory of a linked worktree is read-only in the Codex sandbox, so `git commit` in a worktree needs an approval.
- **OMP:** no extra setting.

## Coordination between parallel agents

GitHub is a record store, not a message bus. Do not use comments to chat between agents. Keep at most one marker comment per issue and edit it in place.

## Stacked PRs

> **Skip this section if `stacked_prs` is off.** `stacked_prs` needs `pr_loop`.

Use a stack for a chain of dependent changes in one repo, where each PR builds on the one before it. Independent deliverables are separate PRs, not a stack.

Setup (once per machine): `gh extension install github/gh-stack --pin v0.3.0`. `gdm doctor` reports an error when `stacked_prs` is on and the extension is missing.

Day-to-day commands:

```sh
gh stack init
gh stack add <branch>
gh stack submit
gh stack sync
```

Rules:

- Each PR in the stack runs the full loop in [`pr-loop.md`](pr-loop.md). Watch them together: `gdm pr watch <owner/repo#N> <owner/repo#M>`.
- Merging a stack is a merge action. Run `gdm pr can-merge <pr>` for the PR you are about to merge, and apply the merge authority, before `gh stack merge`.
- After a lower PR merges, run `gh stack sync` so the rest rebase onto the new base.
