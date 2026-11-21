---
name: github-dev-methodology
description: GitHub Issues + Projects workflow for AI agents - PR review loop, issue schema, plan-to-issues, worktrees and stacked PRs, merge authority. Use for any branch, issue, PR, review or merge work in a repo that has .github-dev-methodology/config.json.
metadata:
  version: 1.0.1
---

# github-dev-methodology

Read this file first for any branch, issue, PR, review or merge work in a repo that has `.github-dev-methodology/config.json`. In a repo without that file, this methodology does not apply. To adopt it, see [`references/installation.md`](references/installation.md).

## 1. The `gdm` command

`gdm` is a zero-dependency Node CLI. It has no PATH shim. Run it as:

```sh
node <skill-dir>/scripts/gdm.mjs <group> <command> [args]
```

`<skill-dir>` is the directory that contains this `SKILL.md`. In every document, `gdm` means that full command. Two global flags work on every command: `--json` (machine-readable output) and `--cwd <dir>`.

Exit codes are the same for every command:

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Failure or drift |
| 2 | Timeout |
| 3 | Not ready |
| 4 | Needs a human |
| 64 | Usage error |
| 130 | Interrupted |

## 2. Start of every session

1. Make sure the repo root has `.github-dev-methodology/config.json`. If it does not, ask the owner for a preset, the GitHub org and the repo name, then run `gdm init --preset <preset> --org <org> --repo <repo>`.
2. Run `gdm doctor` once. Fix every error it prints before any other work. Warnings are advice.
3. Run `gdm config features --json`. It lists the resolved feature flags and the reference files that are active. Read only those files.
4. Read an active reference only when you need it, not all at once.

A reference file is skipped when its `feature` flag is off, when a flag in its `requires.features` is off, or when a key in its `requires.config` is empty. An inline note of the form `Skip this section if <flag> is off` overrides the file inside that file. Never offer a recipe whose feature is off, and never ask for config values that only a disabled feature needs.

## 3. Choose the lane first

Pick the lightest lane that fits. Do not run a heavier lane than the work needs.

| Lane | Use it for | Steps |
|---|---|---|
| 0 | A bot dependency PR, or a docs or typo change with no behaviour change | Worktree, then PR, then `gdm pr watch` (CI-only is allowed), then merge as the merge authority allows. No issue. No validators. |
| 1 | One defect or one feature | Issue (when `issue_schema` is on), then claim it (assign yourself, set project Status `In progress`), then `gdm worktrees add`, then a PR with `Closes owner/repo#N`, then the full PR loop. |
| 2 | Several independent deliverables, or work across repos | Plan, then `gdm plan sync`, then `parallel_validation`, then each child as a Lane 1. Dependent chains in one repo go in as stacked PRs. |

## 4. Rules that always apply

- Never commit on the default branch. Work in a branch, in a worktree, and open a PR.
- Never merge, enable auto-merge, add a PR to a merge queue, or run `gh stack merge` unless `gdm pr can-merge <pr>` exits 0. See "Merge authority" in [`references/pr-loop.md`](references/pr-loop.md).
- Investigation findings are not approval. Wait for an explicit "go" before you change anything shared. See [`references/audit-vs-execute.md`](references/audit-vs-execute.md).
- Never force-push or skip hooks without explicit owner instruction.
- GitHub is the record store. Use native sub-issues, issue dependencies, issue types and project fields. Do not copy that metadata into issue bodies.

## 5. Reference index

Always read when needed:

| File | Content |
|---|---|
| [`references/configuration.md`](references/configuration.md) | Config schema v1, presets, flags, data layout, migration |
| [`references/installation.md`](references/installation.md) | Install, update and remove per client; GitHub auth scopes |

Feature-gated (the `feature` column is the flag that enables the file):

| File | `feature` | Presets that enable it | Content |
|---|---|---|---|
| [`references/pr-loop.md`](references/pr-loop.md) | `pr_loop` | pr-only, single-issue, full | PR review loop, exit predicate, wait modes, merge authority |
| [`references/commits.md`](references/commits.md) | `conventional_commits` | pr-only, single-issue, full | Conventional Commits 1.0 and reviewer-request mechanics |
| [`references/agents-orchestration.md`](references/agents-orchestration.md) | `agents_orchestration` | pr-only, single-issue, full | Orchestrator plus fresh subagents; optional review gates (`subagent_review`) |
| [`references/audit-vs-execute.md`](references/audit-vs-execute.md) | `audit_vs_execute` | pr-only, single-issue, full | Findings are not approval; the merge gate |
| [`references/worktrees-and-stacks.md`](references/worktrees-and-stacks.md) | `worktrees` | pr-only, single-issue, full | One worktree per agent; stacked PRs (`stacked_prs`) |
| [`references/issue-schema.md`](references/issue-schema.md) | `issue_schema` | single-issue, full | Issue body sections and native metadata |
| [`references/issue-lifecycle.md`](references/issue-lifecycle.md) | `issue_lifecycle` | single-issue, full | Issue, branch, PR, merge, close; who owns each status |
| [`references/label-taxonomy.md`](references/label-taxonomy.md) | `label_taxonomy` | full | Locked and extensible label families |
| [`references/plan-to-issues.md`](references/plan-to-issues.md) | `plan_to_issues` | full | Plan manifest to a wired sub-issue tree |
| [`references/parallel-validation.md`](references/parallel-validation.md) | `parallel_validation` | full | Three audit agents on touched issues only |
| [`references/plan-deprecation.md`](references/plan-deprecation.md) | `plan_deprecation` | full | Shrink the plan file after migration |
| [`references/cold-start.md`](references/cold-start.md) | `cold_start` | full | Pick up an issue with zero context |

Sections inside these files carry their own flags: `copilot_review` (in `pr-loop.md`), `subagent_review` (in `agents-orchestration.md`), `stacked_prs` (in `worktrees-and-stacks.md`).

## 6. Command quick reference

| Command | Use |
|---|---|
| `gdm init --preset <p> --org <o> --repo <r> [--project <slug>]` | Create the repo config and the `AGENTS.md` block. Safe to repeat. |
| `gdm doctor [--json]` | Check Node, `gh`, token scopes, config, worktrees and legacy files. |
| `gdm config get <dotted.key>` | Read one config value. |
| `gdm config features [--json]` | Resolved flags and active reference files. |
| `gdm config migrate <old.config.local.md> [--write]` | Convert a v0 markdown config to v1 JSON. |
| `gdm pr request-reviews <pr>` | Request the configured reviewers and verify the requests landed. |
| `gdm pr watch <owner/repo#N>... [--bounded <sec>] [--max-wait <sec>] [--json]` | Wait on the exit predicate. |
| `gdm pr threads <pr> [--author <login>] [--resolve <threadId>...] [--json]` | List or resolve unresolved review threads. |
| `gdm pr can-merge <pr>` | Merge-authority decision. Exit 0 means you may merge. |
| `gdm worktrees add <branch> [--base <ref>] [--owner <text>]` | Create a branch worktree, record its owner and lock it as your lease. Prints its path. |
| `gdm worktrees release [<path\|branch>]` | Drop the lease when your session ends. Defaults to the current worktree. |
| `gdm worktrees census [--json]` | List worktrees with dirty state, PR state, owner and lock age. |
| `gdm worktrees prune <path\|branch>... [--json]` | Remove the named worktrees when released, clean and merged. |
| `gdm worktrees prune --all-merged [--json]` | Owner cleanup: remove every released gdm worktree that is clean and merged. |
| `gdm plan sync <manifest.json> [--dry-run]` | Create or complete a sub-issue tree from a manifest. |
| `gdm validate tree <issue-url> [--up]` | Check the sub-issue tree; `--up` walks to the root. |
| `gdm validate issues <owner/repo> [--touched 1,2] [--state open\|all]` | Check issue body sections. |
| `gdm validate labels <owner> [--repos a,b] [--fix]` | Check the locked label set. |
| `gdm validate release` | Methodology repo only: check docs, schema and versions agree. |
| `gdm hook session-start --client claude\|codex` | Called by the client hook; prints session context. |
| `gdm hook pre-tool-use --client claude\|codex` | Called by the client hook; blocks merges the authority forbids. |

Validators run when you choose to run them. Skip a validator whose feature is off.

## 7. Where things live

| What | Path |
|---|---|
| Repo settings (committed) | `<repo>/.github-dev-methodology/config.json` |
| Personal overrides (gitignored) | `<repo>/.github-dev-methodology/config.local.json` |
| User config (optional) | `~/.github-dev-methodology/config.json` |
| Worktrees | `~/.github-dev-methodology/worktrees/<host>/<owner>/<repo>/<branch>` |
| State (plan ledgers) | `~/.github-dev-methodology/state/<host>/<owner>/<repo>/` |

Details: [`references/configuration.md`](references/configuration.md).

## 8. Source of truth

With `plan_to_issues` or `issue_lifecycle` on, GitHub Issues and the Project are the source of truth for multi-issue work. Local plan files are scratch. With the `pr-only` preset there is no project tree, and plans stay local.

## 9. Optional subagents

`agents_orchestration` fans work out to three read-only helper agents: `agent-codebase-explorer`, `agent-plan-reviewer`, `agent-implementation-auditor`. They are optional. Offer them once, when you set up a repo, and install them at user scope only if the owner agrees:

```sh
npx @ctxr/kit@latest install --user @ctxr/agent-codebase-explorer @ctxr/agent-plan-reviewer @ctxr/agent-implementation-auditor
```

Without them the orchestrator runs the fan-out and the review gates inline. Do not ask again in later sessions. See [`references/agents-orchestration.md`](references/agents-orchestration.md).
