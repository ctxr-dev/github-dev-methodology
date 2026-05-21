# github-dev-methodology.config.local.md

> **This file is gitignored.** Add `*.local.md` to your `.gitignore` if not already there.
> **Each machine fills in its own values.** Don't share via git.
> **Lives at:** `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md`

This file can track **one or many GitHub Projects**. Add a `## Project: <slug>` section per project, then point `active_project` at the slug the agent should use by default. Scripts accept `--project <slug>` to override per invocation; agents switch on a "use project <slug>" instruction.

## Active

| Key | Value |
|---|---|
| `active_project` | <fill: slug from a `## Project:` section below> |

## Project: <slug>

> Duplicate this whole section (heading and all) to track another project. The slug after `Project:` is the value you put in `active_project` above (and pass to `--project`). Keep slugs short and shell-safe (`my-app`, `web`, `infra`).

### Project values

| Key | Value |
|---|---|
| `project_url` | <fill: https://github.com/orgs/YOUR-ORG/projects/N/views/1> |
| `org` | <fill: github org name> |
| `primary_repo` | <fill: main repo name> |
| `sibling_repos` | <fill: comma-separated, or empty> |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `default_reviewer` | <one of: `copilot`, `<github-login>`, `ask`> |
| `copilot_bot_id` | <auto-discovered after first PR; e.g. `BOT_kgDOXXXXXX`> |
| `pr_loop_poll_seconds` | 300 |
| `pr_loop_max_hours` | 24 |

### Dev-loop modes (if the project supports them; see methodology pr-loop.md)

| Key | Value |
|---|---|
| `default_dev_loop_mode` | <one of: `autonomous`, `interactive`, `handoff`> |
| `polling_paradigm` | <one of: `wakeup`, `background`> |

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | minimize |

## Notes for the agent

- This config is read at the start of every session that uses the methodology.
- Default project is named by `active_project`. To use a different project for one invocation, pass `--project <slug>` to a script, or tell the agent "use project <slug> for this session".
- When a value is discovered (e.g. `copilot_bot_id` after first review), update the row in the relevant project's section and mention the change in chat.
- If a value is missing AND a methodology recipe needs it, halt and ask the user before proceeding.
- To add another project: duplicate the entire `## Project: <slug>` section, change the slug, fill in the values, and optionally switch `active_project` to it.
