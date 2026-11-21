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
| `gdm worktrees add <branch> [--base <ref>] [--owner <text>]` | Fetches `origin`, then creates the worktree and a new branch from `--base` (default `origin/<default branch>`). If the branch already exists, it checks that branch out in the new worktree. If the path exists, it exits 1 with `worktree path exists: <path>`. Then it records the owner and takes a lease: a `git worktree lock` with the reason `gdm: owner=<owner> created=<iso>`. The owner defaults to `<hostname>:<parent pid>`. If the lock fails, it prints a warning and still succeeds. The last line of output is the absolute path. |
| `gdm worktrees release [<path\|branch>]` | Drops the lease with `git worktree unlock`. The target defaults to the worktree that contains the current directory. It prints `not locked: <path>` when there is no lock. It never unlocks a lock that another tool took (reason not starting with `gdm:`) and exits 1. |
| `gdm worktrees census [--json]` | Lists every registered worktree with its branch, dirty state, PR state, last-commit age, owner, lock reason and lock age. A worktree with an owner record is flagged `gdm-owned`. Also reports directories under the worktree root that git does not know (`orphan-dir`) and registered worktrees outside the root (`legacy-location`). It reports only. It never deletes. |
| `gdm worktrees prune <path\|branch>... [--json]` | Removes the named worktrees, and only a worktree that is not locked, is clean and has a merged PR. Then it deletes the local branch with `git branch -d` (never `-D`), deletes the owner record, removes empty parent directories up to the worktree root, and runs `git worktree prune`. Prints what it removed and what it kept, with the reason. A locked worktree is kept with the hint `run gdm worktrees release first`. |
| `gdm worktrees prune --all-merged [--json]` | Owner cleanup. Considers only worktrees that are inside the worktree root, have an owner record and are not locked, then applies the same rules. Everything else is skipped (listed under `skipped` in `--json`). |

`gdm worktrees prune` needs either targets or `--all-merged`. With neither, or with both, it exits 64.

Never remove a dirty worktree. Never use `--force`. Prune never touches client-managed worktrees (`<repo>/.claude/worktrees`, `~/.codex/worktrees`, `~/.omp/wt`): a named target there is kept with `client-managed worktree`.

## Leases and ownership

Several agents and several projects share one worktree root. The lease keeps one agent from removing another agent's worktree.

- `gdm worktrees add` writes an owner record to `~/.github-dev-methodology/state/<host>/<owner>/<repo>/worktrees/<branch>.json` and locks the worktree. A locked worktree is an active lease. Prune keeps it.
- Only the agent that created a worktree prunes it, by name. Never prune a worktree you did not create.
- `--all-merged` is for the owner. It never removes a worktree that is locked, that has no owner record (created by plain `git worktree add`), or that is outside the worktree root.
- A stale lock from a crashed agent shows in `gdm worktrees census` with its owner and age. Release it by hand: `gdm worktrees release <branch>`.

## Working in a worktree

1. Create it: `gdm worktrees add <type>/<issue>-<slug>`. The worktree is now yours and locked.
2. Start the agent session with the worktree as its working directory. Then the committed `.github-dev-methodology/config.json`, `AGENTS.md` and the client's project config load from the worktree.
3. Run `gdm worktrees census` at the start of a session. Pick up or clean up what it lists before you create more. Do not touch worktrees that other owners hold.
4. When your session finishes with the worktree, run `gdm worktrees release`. Do this before you end the session, also when the PR is still open.
5. After the PR is merged, run `gdm worktrees prune <branch>` from outside the worktree.
6. The owner can clean up all released, merged gdm worktrees in one go with `gdm worktrees prune --all-merged`.

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
