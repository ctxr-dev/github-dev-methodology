# github-dev-methodology.config.local.md

> **This file is gitignored.** Per-machine values; not shared via git.
> **Lives at:** `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md`

This file tracks one or many GitHub Projects. Point `active_project` at the slug the agent should use by default.

## Active

| Key | Value |
|---|---|
| `active_project` | tradingtune |

## Project: tradingtune

> TradingTune org. `workspace` is the umbrella repo; `browser-plugin` and `landing` are cloned as ignored subfolders inside it. One board for all three repos.

### Features

Preset: **full**, with `copilot_review` disabled (owner decision 2026-10-17: Copilot never answered the review request on browser-plugin PR #57 during a 54 minute watch, and browser-plugin PRs #57, #58, #64, #65, #67, #73, #74 and #75 have no Copilot review; re-enable it only after a Copilot review is seen again).

| Feature | Enabled |
|---|---|
| `pr_loop` | true |
| `copilot_review` | false |
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
| `project_url` | https://github.com/orgs/tradingtune/projects/1/views/1 |
| `org` | tradingtune |
| `primary_repo` | workspace |
| `sibling_repos` | browser-plugin, landing |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `reviewers` | none (no automated or human reviewer is requested; the PR-loop exit predicate is CI green on HEAD) |
| `required_reviewers` | none |
| `pr_loop_poll_seconds` | 300 |
| `pr_loop_max_hours` | 24 |

### Dev-loop modes

| Key | Value |
|---|---|
| `default_dev_loop_mode` | autonomous |

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | delete |

> Durable context from a deleted plan lives in the migrated epic and issue bodies.

### Proportionality (match the process to the size of the change)

The `full` preset is the ceiling, not the default for every change. Scale the process to the work:

- Green dependabot and other bot dependency PRs: when the owner asks for them to be merged (or has said to be autonomous on this task), merge once CI is green on HEAD; never merge them on your own initiative (`audit_vs_execute` keeps merge human-gated). For a major-version bump of a runtime or test-environment dependency (for example preact 11, happy-dom 21), also run `pnpm run verify` and `pnpm run test:e2e` locally first. No epic, no issue tree (`plan_to_issues`), no `parallel_validation` or `cold_start` agents, no reviewer wait.
- One issue per real defect or feature. Do not open an epic with children unless the work spans several independent deliverables.
- Live or external-system checks (the TradingView monitors, store uploads, production smoke) run once per release, not per PR, unless the PR changes code that can only be proven live (for example `tools/lib/tv-session.mjs` or TradingView selectors): then run the live check once on that PR's branch before merge.
- No reviewer wait: `copilot_review` is false and no reviewer is configured (`reviewers` and `required_reviewers` hold `none`, which here means an empty set, not a login). The `pr_loop` exit predicate is then CI green on HEAD; `scripts/pr-review-watch.mjs` needs at least one `--reviewer`, so watch CI with `gh pr checks <N> --watch` instead.

## GitHub native Issue Types (org-level, tradingtune)

| Name | node_id | color | description |
|---|---|---|---|
| Task | IT_kwDOEPJ_m84B_wT_ | yellow | A specific piece of work |
| Bug | IT_kwDOEPJ_m84B_wUA | red | An unexpected problem or behavior |
| Feature | IT_kwDOEPJ_m84B_wUB | blue | A request, idea, or new functionality |
| Epic | IT_kwDOEPJ_m84CAvN7 | PURPLE | Top-level mission with a sub-issue tree |

## ctxr-dev type:* → native Issue Type mapping

| ctxr-dev `type:` | Native Issue Type | Approach |
|---|---|---|
| `epic` | Epic | B (auto-create) |
| `feature` | Feature | A (existing) |
| `enhancement` | Feature | A (existing) |
| `bug` | Bug | A (existing) |
| `refactor` | Task | A (existing) |
| `docs` | Task | A (existing) |
| `chore` | Task | A (existing) |

## Notes for the agent

- Read the active project's `### Features` table first; only follow recipes whose `feature` is on and whose `requires.config` keys are non-empty.
- Polling is always foreground.
- When a value is discovered (e.g. `copilot_bot_id` after first review), update the row here and mention the change in chat.
