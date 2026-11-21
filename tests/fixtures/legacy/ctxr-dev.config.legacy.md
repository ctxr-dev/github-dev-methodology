# github-dev-methodology.config.local.md

> **This file is gitignored.** Add `*.local.md` to your `.gitignore` if not already there.
> **Each machine fills in its own values.** Don't share via git.
> **Lives at:** `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md`

This file can track **one or many GitHub Projects**. Add a `## Project: <slug>` section per project, then point `active_project` at the slug the agent should use by default. Scripts accept `--project <slug>` to override per invocation; agents switch on a "use project <slug>" instruction.

## Active

| Key | Value |
|---|---|
| `active_project` | ctxr-dev |

## Project: ctxr-dev

> Migrated 2026-05-22 from `.claude/memory/ctxr-dev.config.local.md` (legacy single-project layout). Feature flags added 2026-05-22 with all 12 ON (matches the pre-feature-flag behaviour: full project board + plan-to-issues + cold-start + labels + native Issue Type).

### Features

Preset: `full` (all 12 on). Flip any flag to `false` to drop that recipe.

| Feature | Enabled |
|---|---|
| `pr_loop` | true |
| `copilot_review` | true |
| `conventional_commits` | true |
| `agents_orchestration` | true |
| `audit_vs_execute` | true |
| `issue_schema` | true |
| `issue_lifecycle` | true |
| `label_taxonomy` | true |
| `plan_to_issues` | true |
| `parallel_validation` | true |
| `plan_deprecation` | true |
| `cold_start` | true |

### Project values

| Key | Value |
|---|---|
| `project_url` | https://github.com/orgs/ctxr-dev/projects/1/views/1 |
| `org` | ctxr-dev |
| `primary_repo` | agent-staff-engineer |
| `sibling_repos` | skill-code-review, fsm, skill-llm-wiki, mcp-github, llm-wiki-memory |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `default_reviewer` | copilot |
| `copilot_bot_id` | BOT_kgDOCnlnWA |
| `pr_loop_poll_seconds` | 300 |
| `pr_loop_max_hours` | 24 |

### Dev-loop modes

| Key | Value |
|---|---|
| `default_dev_loop_mode` | autonomous |

> `polling_paradigm` was removed 2026-05-22 — polling is now always foreground; the agent must keep the PR-loop in the foreground (no callbacks, no wake-ups). See `pr-loop.md`.

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | minimize |

## Project: omp-plugins

> Added 2026-09-07 for the three solo OMP-plugin repos (built by an agent, no project board of their own). `single-issue` preset only: issue/PR loop, no label taxonomy, no plan-to-issues, no project board. Use `--project omp-plugins` or "use project omp-plugins" when working in these repos.

### Features

Preset: `single-issue` (`pr-only` + `issue_schema`, `issue_lifecycle`, `subagent_review`). Flip any flag to `false` to drop that recipe.

| Feature | Enabled |
|---|---|
| `pr_loop` | true |
| `copilot_review` | true |
| `conventional_commits` | true |
| `agents_orchestration` | true |
| `audit_vs_execute` | true |
| `issue_schema` | true |
| `issue_lifecycle` | true |
| `label_taxonomy` | false |
| `plan_to_issues` | false |
| `parallel_validation` | false |
| `plan_deprecation` | false |
| `cold_start` | false |
| `subagent_review` | true |

### Project values

| Key | Value |
|---|---|
| `project_url` | <not used: single-issue> |
| `org` | ctxr-dev |
| `primary_repo` | omp-perfect-coder |
| `sibling_repos` | omp-delayed-execution, omp-forensics |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `reviewers` | copilot |
| `required_reviewers` |  |
| `pr_loop_wait_for` | any |
| `copilot_bot_id` | BOT_kgDOCnlnWA |
| `pr_loop_poll_seconds` | 60 |
| `pr_loop_max_hours` | 24 |

### Dev-loop modes

| Key | Value |
|---|---|
| `default_dev_loop_mode` | autonomous |

## Notes for the agent

- This config is read at the start of every session that uses the methodology.
- Default project is named by `active_project` (currently `ctxr-dev`). To use a different project for one invocation, pass `--project <slug>` to a script, or tell the agent "use project <slug> for this session".
- When a value is discovered (e.g. a new `copilot_bot_id`), update the row in the relevant project's section and mention the change in chat.
- If a value is missing AND a methodology recipe needs it, halt and ask the user before proceeding.
- To add another project: duplicate the entire `## Project: <slug>` section, change the slug, fill in the values, and optionally switch `active_project` to it.
- Legacy install at `.claude/memory/ctxr-dev/` is intentionally kept intact (per user request); the methodology now lives at `.agents/ctxr-dev/github-dev-methodology/`.
