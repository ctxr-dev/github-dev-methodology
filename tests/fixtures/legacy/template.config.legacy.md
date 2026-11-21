# github-dev-methodology.config.local.md

> **This file is gitignored.** Add `*.local.md` to your `.gitignore` if not already there.
> **Each machine fills in its own values.** Don't share via git.
> **Lives at:** `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md`

This file can track **one or many GitHub Projects**. Add a `## Project: <slug>` section per project, then point `active_project` at the slug the agent should use by default. Scripts accept `--project <slug>` to override per invocation; agents switch on a "use project <slug>" instruction.

Each project carries a `### Features` table that drives which methodology recipes the agent applies. See [`local-config.md`](../local-config.md) for the full flag list and the 3 install presets (`pr-only` / `single-issue` / `full`).

## Active

| Key | Value |
|---|---|
| `active_project` | <fill: slug from a `## Project:` section below> |

## Project: <slug>

> Duplicate this whole section (heading and all) to track another project. The slug after `Project:` is the value you put in `active_project` above (and pass to `--project`). Keep slugs short and shell-safe (`my-app`, `web`, `infra`).

### Features

Defaults below = the `pr-only` preset. Flip to `true` to opt into more recipes. See [`local-config.md`](../local-config.md) for what each flag gates and which `requires.config` keys it needs.

| Feature | Enabled |
|---|---|
| `pr_loop` | true |
| `copilot_review` | true |
| `conventional_commits` | true |
| `agents_orchestration` | true |
| `audit_vs_execute` | true |
| `issue_schema` | false |
| `issue_lifecycle` | false |
| `label_taxonomy` | false |
| `plan_to_issues` | false |
| `parallel_validation` | false |
| `plan_deprecation` | false |
| `cold_start` | false |
| `subagent_review` | false |

### Project values

Fields unused by the current feature set may be left as `<not used: pr-only>` (or your active preset name) until you upgrade. The agent reads them only when the feature that needs them is on.

| Key | Value |
|---|---|
| `project_url` | <fill: https://github.com/orgs/YOUR-ORG/projects/N/views/1> |
| `org` | <fill: github org name> |
| `primary_repo` | <fill: main repo name> |
| `sibling_repos` | <fill: comma-separated, or empty> |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `reviewers` | <comma-separated INDIVIDUAL logins watched per PR: `copilot`, `<github-login>` (a `<team-slug>` is not tracked by the watch, list members instead); or `ask` for first-run discovery> |
| `required_reviewers` | <subset of `reviewers` whose APPROVED gates merge; humans only; may be empty> |
| `pr_loop_wait_for` | <one of: `any` (default), `smart`, `all`, `quorum:N`> |
| `copilot_bot_id` | <auto-discovered after first PR; e.g. `BOT_kgDOXXXXXX`> |
| `pr_loop_poll_seconds` | 60 |
| `pr_loop_max_hours` | 24 |

### Dev-loop modes (if the project supports them; see methodology pr-loop.md)

| Key | Value |
|---|---|
| `default_dev_loop_mode` | <one of: `autonomous`, `interactive`, `handoff`> |

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | minimize |

## Notes for the agent

- This config is read at the start of every session that uses the methodology.
- **Read the active project's `### Features` table first.** Only follow methodology recipes whose `feature` is on AND whose `requires.features` are all on AND whose `requires.config` keys are non-empty. See the active-features preamble at the top of [`../index.md`](../index.md).
- Default project is named by `active_project`. To use a different project for one invocation, pass `--project <slug>` to a script, or tell the agent "use project <slug> for this session".
- When a value is discovered (e.g. `copilot_bot_id` after first review), update the row in the relevant project's section and mention the change in chat.
- If a value is missing AND a methodology recipe needs it (per the recipe's `requires.config`), halt and ask the user before proceeding.
- To add another project: duplicate the entire `## Project: <slug>` section, change the slug, fill in the values, and optionally switch `active_project` to it.
- **Polling is always foreground.** No `polling_paradigm` flag any more (formerly `wakeup | background`); the agent must keep the PR-loop in the foreground. See `pr-loop.md`.
