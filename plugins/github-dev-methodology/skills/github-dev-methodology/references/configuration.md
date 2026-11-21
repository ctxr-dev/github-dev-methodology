# Configuration

Settings are JSON. There are three kinds of file, and each has one owner:

| File | Scope | Committed |
|---|---|---|
| `<repo>/.github-dev-methodology/config.json` | Repo settings, shared by the team | Yes |
| `<repo>/.github-dev-methodology/config.local.json` | Personal overrides for this repo | No (gitignored) |
| `~/.github-dev-methodology/config.json` | User settings (optional) | Not in any repo |

`gdm` means `node <skill-dir>/scripts/gdm.mjs`; see [`SKILL.md`](../SKILL.md). Create the repo config with `gdm init`. Check it with `gdm doctor`. Read one value with `gdm config get <dotted.key>`. See the resolved flags and the active reference files with `gdm config features --json`.

## Repo config, schema version 1

The schema is [`assets/config.schema.json`](../assets/config.schema.json) (JSON Schema 2020-12). A valid starting file is [`assets/config.template.json`](../assets/config.template.json). One file can describe several GitHub projects.

```json
{
  "$schema": "https://raw.githubusercontent.com/ctxr-dev/github-dev-methodology/v1.0.0/plugins/github-dev-methodology/skills/github-dev-methodology/assets/config.schema.json",
  "schema_version": 1,
  "active_project": "<slug>",
  "projects": {
    "<slug>": {
      "preset": "pr-only",
      "features": {},
      "org": "<owner>",
      "primary_repo": "<repo>",
      "sibling_repos": [],
      "project_url": null,
      "review": {
        "reviewers": [],
        "required_reviewers": [],
        "bot_review_timeout_minutes": 15,
        "poll_seconds": 60,
        "max_hours": 24,
        "wait_mode": "foreground"
      },
      "merge": { "authority": "human", "scopes": [] },
      "plans": { "post_migration": "minimize" },
      "cache": { "copilot_bot_id": null }
    }
  }
}
```

### Keys

| Key | Type and values | Meaning |
|---|---|---|
| `$schema` | string | URL of the schema at the release tag. |
| `schema_version` | `1` | Config format version. |
| `active_project` | string | Slug of the project section to use. |
| `projects.<slug>.preset` | `pr-only`, `single-issue` or `full` | Starting set of feature flags. |
| `projects.<slug>.features` | object of flag to boolean | Per-flag overrides applied after the preset. An unknown key is an error. |
| `projects.<slug>.org` | string | GitHub owner (user or org). |
| `projects.<slug>.primary_repo` | string | Repo name that holds the issues and the main code. |
| `projects.<slug>.sibling_repos` | array of strings | Other repos in the same project. |
| `projects.<slug>.project_url` | string or `null` | GitHub Project board URL. Only board features read it. |
| `projects.<slug>.review.reviewers` | array of logins | Reviewers requested on every PR. `[]` means CI-only. `copilot` is an alias for `copilot-pull-request-reviewer`. List individual logins: a team is tracked through its members. |
| `projects.<slug>.review.required_reviewers` | array of logins | Subset of `reviewers` whose `APPROVED` gates merge. Humans only. May be empty. |
| `projects.<slug>.review.bot_review_timeout_minutes` | integer, default 15 | Minutes after a HEAD push before a silent bot stops blocking. |
| `projects.<slug>.review.poll_seconds` | integer, default 60 | Watch polling interval. |
| `projects.<slug>.review.max_hours` | integer, default 24 | Longest total watch time. |
| `projects.<slug>.review.wait_mode` | `foreground` or `wakeup` | How the agent waits. See [`pr-loop.md`](pr-loop.md). |
| `projects.<slug>.merge.authority` | `human`, `scoped` or `autonomous` | Who may merge. New installs use `human`. |
| `projects.<slug>.merge.scopes` | array of `dependabot-green`, `session-instruction` | What `scoped` authority allows. |
| `projects.<slug>.plans.post_migration` | `minimize` or `delete` | What happens to the plan file after it becomes issues. |
| `projects.<slug>.cache.copilot_bot_id` | string or `null` | Cached Copilot bot node id. `gdm pr request-reviews` fills it in. |

Slugs are short, shell-safe labels such as `my-app` or `web`.

### Selecting a project

In order of precedence:

1. `--project <slug>` on a command that accepts it.
2. An explicit instruction in the session: "use project `<slug>`".
3. `active_project`.

## Personal overrides: `config.local.json`

`.github-dev-methodology/config.local.json` has the same shape as `config.json` and is optional. It is merged over the committed file, and its values win. `gdm init` writes `.github-dev-methodology/.gitignore` with exactly `config.local.json`, so personal values never reach a commit. Use it for a personal reviewer set, a different `wait_mode`, or `cache` values.

## Feature flags

There are 15 flags. Each maps to one reference file or one section.

| Flag | Gates |
|---|---|
| `pr_loop` | [`pr-loop.md`](pr-loop.md): the PR review loop |
| `copilot_review` | The Copilot request and discovery parts of `pr-loop.md` and `commits.md`. Off: use plain `gh pr edit --add-reviewer <login>`. |
| `conventional_commits` | [`commits.md`](commits.md): commit message format |
| `agents_orchestration` | [`agents-orchestration.md`](agents-orchestration.md): orchestrator and fresh subagents |
| `audit_vs_execute` | [`audit-vs-execute.md`](audit-vs-execute.md): findings are not approval. Turning it off removes the merge gate and the bulk-edit safeguards. Not recommended. |
| `issue_schema` | [`issue-schema.md`](issue-schema.md): issue body shape and validators |
| `issue_lifecycle` | [`issue-lifecycle.md`](issue-lifecycle.md): single-issue, single-PR flow |
| `label_taxonomy` | [`label-taxonomy.md`](label-taxonomy.md): locked and extensible labels |
| `plan_to_issues` | [`plan-to-issues.md`](plan-to-issues.md): plan manifest to a sub-issue tree |
| `parallel_validation` | [`parallel-validation.md`](parallel-validation.md): three-agent audit after a migration |
| `plan_deprecation` | [`plan-deprecation.md`](plan-deprecation.md): shrink the plan file after migration |
| `cold_start` | [`cold-start.md`](cold-start.md): pick up an issue with zero context |
| `subagent_review` | The optional plan-review and conformance-review gates in `agents-orchestration.md` |
| `worktrees` | [`worktrees-and-stacks.md`](worktrees-and-stacks.md): branch worktrees under `~/.github-dev-methodology/worktrees/` |
| `stacked_prs` | The stacked PR section of `worktrees-and-stacks.md` |

### Dependencies

A flag that is on needs its parent to be on too. A violation is an error that names both flags.

- `copilot_review` needs `pr_loop`.
- `stacked_prs` needs `pr_loop`.
- `subagent_review` needs `agents_orchestration`.
- `plan_to_issues` needs `issue_schema`.
- `parallel_validation` needs `plan_to_issues`.
- `plan_deprecation` needs `plan_to_issues`.
- `cold_start` needs `issue_schema`.

## Presets

A preset sets the starting flags. The `features` object then overrides single flags.

| Preset | Flags on | Pick it when |
|---|---|---|
| `pr-only` | `pr_loop`, `copilot_review`, `conventional_commits`, `agents_orchestration`, `audit_vs_execute`, `worktrees` | You want the PR loop and worktrees. No issues, no project board. |
| `single-issue` | Everything in `pr-only`, plus `issue_schema`, `issue_lifecycle`, `subagent_review` | You file an issue per fix but run no project board. |
| `full` | All 15 flags | You run a GitHub Project with sub-issue trees, labels, plan migration, cold start and plan deprecation. |

Fields that your preset does not use stay at their template values, for example `project_url: null` under `pr-only`.

## Reference file frontmatter

Every feature-gated reference file starts with a frontmatter block:

```yaml
---
feature: <flag>
requires:
  features: [<other_flag>]
  config: [<config_key>]
---
```

The file is active only when its `feature` is on, every `requires.features` flag is on, and every `requires.config` key is non-empty in the active project. `requires.features` lists exactly the dependency parent of the flag, or nothing. `requires.config` uses the keys `org`, `primary_repo` and `project_url`. This file and `installation.md` have no frontmatter and are always readable.

Order of precedence: file gate (frontmatter), then section gate (a `Skip this section if <flag> is off` note), then recipe step. `gdm config features --json` applies the file gate for you.

## User config

`~/.github-dev-methodology/config.json` is optional. When it is absent, defaults apply. A template is [`assets/user-config.template.json`](../assets/user-config.template.json):

```json
{ "schema_version": 1, "worktrees_root": "~/.github-dev-methodology/worktrees" }
```

`worktrees_root` is the only key. A leading `~` expands to the home directory. Set the environment variable `GDM_HOME` to move the whole data home.

## Data layout

```
~/.github-dev-methodology/                 (GDM_HOME)
├── config.json                            user config (optional)
├── worktrees/<host>/<owner>/<repo>/<branch>
└── state/<host>/<owner>/<repo>/           state such as plans/<plan_id>.ledger.json

<repo>/
├── AGENTS.md                              one marked block: gdm:start ... gdm:end
└── .github-dev-methodology/
    ├── config.json                        committed settings
    ├── config.local.json                  personal overrides (gitignored)
    └── .gitignore                         contains config.local.json
```

Plugin code is not here. Each client keeps it in its own plugin cache. The methodology makes no symlinks into a repo, and it does not edit the root `.gitignore`, `CLAUDE.md`, `.mcp.json` or `.claude/settings.json`.

## Updating the config

Edit the JSON file directly, then run `gdm doctor`. When the agent learns a value that belongs in the config, it writes the key to the repo config and says so in chat. `gdm pr request-reviews` writes `cache.copilot_bot_id` by itself.

## Migration from v0

Version 0 kept a markdown config at `.agents/ctxr-dev/github-dev-methodology.config.local.md` and a git clone at `.agents/ctxr-dev/github-dev-methodology/`.

1. Convert and review the config: `gdm config migrate <old.config.local.md>` prints v1 JSON for every `## Project:` section. Add `--write` to write it to `.github-dev-methodology/config.json`.
2. Read stderr. Every dropped key and every free-text heading that was not converted is printed as `not migrated: <heading or key>`. Move anything you still need into `AGENTS.md`.
3. Run `gdm init` with the same preset, org and repo. It adds the `AGENTS.md` block and the `.gitignore` inside the config folder.
4. Replace the old `## Methodologies` bullet that points at the old `index.md` in the clone.
5. Remove the clone `.agents/ctxr-dev/github-dev-methodology/` only when `git -C .agents/ctxr-dev/github-dev-methodology status --porcelain` is empty or lists only `scripts/package-lock.json`. Otherwise stop and report. Delete the old config file. Remove the old lines for the clone and for `*.local.md` from the repo `.gitignore` if nothing else needs them.
6. Run `gdm doctor`. It reports an error while a legacy clone or legacy config is still present.

Mapping rules:

- The old features table becomes an explicit `features` object for all 15 flags with the old meaning. A missing row is `false`. `worktrees` and `stacked_prs` are `false`. `preset` is the matching preset when the set is equal to one, otherwise `full` with overrides.
- `reviewers` (or the old `default_reviewer`) becomes `review.reviewers`. `none` or an empty value becomes `[]`.
- `required_reviewers`, `pr_loop_poll_seconds`, `pr_loop_max_hours`, `plan_post_migration` and `copilot_bot_id` become `review.required_reviewers`, `review.poll_seconds`, `review.max_hours`, `plans.post_migration` and `cache.copilot_bot_id`.
- A value written as `<not used...>` becomes `null`.
- Removed with no replacement: `default_reviewer`, `default_dev_loop_mode`, `pr_loop_wait_for`, `polling_paradigm`.
- `merge.authority` has no v0 value. Set it yourself after migration. The default is `human`.
