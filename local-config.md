# Per-project local config

The methodology stays project-agnostic. Per-project values live in a gitignored markdown file at `.agents/ctxr-dev/github-dev-methodology.config.local.md`. One file can track **one or many GitHub Projects** — useful when a single workspace participates in several boards.

## Schema

```markdown
# github-dev-methodology.config.local.md (gitignored)

## Active

| Key | Value |
|---|---|
| `active_project` | <slug-of-a-Project-section-below> |

## Project: <slug-1>

### Project values

| Key | Value |
|---|---|
| `project_url` | https://github.com/orgs/<OWNER>/projects/<NUM>/views/1 |
| `org` | <OWNER> |
| `primary_repo` | <REPO> |
| `sibling_repos` | <REPO_2>, <REPO_3>, ... |

### Reviewer + PR-loop config

| Key | Value |
|---|---|
| `default_reviewer` | `copilot` \| `<github-login>` \| `ask` |
| `copilot_bot_id` | BOT_kgDOXXXXXX (per-installation; discover via commits.md snippet) |
| `pr_loop_poll_seconds` | 300 (override default 5-min cadence) |
| `pr_loop_max_hours` | 24 (override default 24h max-no-progress) |

### Dev-loop modes

| Key | Value |
|---|---|
| `default_dev_loop_mode` | autonomous \| interactive \| handoff |
| `polling_paradigm` | wakeup \| background |

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | minimize (default) \| delete |

## Project: <slug-2>

... (duplicate the section above; H3 subsections are visual grouping only — the parser pulls keys from any table row under the `## Project: <slug>` H2)
```

`## Active` is parsed for the `active_project` key; that's the project used when no `--project` override is passed. Slugs are user-chosen labels (`my-app`, `web`, `infra`) — keep them short and shell-safe.

## Where the file lives

```
<project-root>/
├── AGENTS.md                                            (committed; entry-point for AI agents)
├── .agents/
│   └── ctxr-dev/
│       ├── github-dev-methodology/                      (cloned methodology; this repo)
│       └── github-dev-methodology.config.local.md       (gitignored; this file)
```

Add to `.gitignore`:

```
.agents/ctxr-dev/github-dev-methodology
*.local.md
```

The first line keeps the cloned methodology (its own `.git/`) from being tracked by the outer project. The second keeps every `*.local.md` (including this config) private. See the README's "Why `.gitignore`" section for the full rationale.

## Selecting a project for the session

Three ways, in precedence order:

1. **`--project <slug>`** passed to a validator script (highest precedence). Used per invocation.
2. **Explicit instruction to the agent** — "use project `<slug>` for this session". The agent loads the named section and proceeds.
3. **`active_project` in the `## Active` section** (default). Used when nothing else is specified.

## How the agent reads it

At session start (or before any methodology recipe runs), the agent:

1. Checks if `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` exists.
2. If yes: reads the file, resolves which project section to use (per the precedence above), and holds the project's keys for the session.
3. If no: creates it from `templates/config.local.md` and **asks the user** to fill in at least the `active_project` pointer plus one `## Project: <slug>` section before proceeding with any methodology recipe.

## Why markdown not JSON

- Human-readable; user edits in their IDE without learning a schema.
- Plain text, no JSON parser needed.
- Per-project H2 sections + H3 sub-tables read top-to-bottom like a small dashboard.
- Comments-as-context easy: `<!-- override because reasons -->` works inline.

## Why gitignored

The values are user- and machine-specific:

- The org might differ if the user works in multiple orgs.
- The Copilot bot ID is per-org-per-repo-installation.
- The default reviewer is a personal preference.
- Polling overrides may be opinion-driven.

These shouldn't accidentally land in commits and propagate to other contributors.

## Updating the config

When the agent discovers a new value (e.g. learns the Copilot bot ID for a repo for the first time), it should:

1. Read the existing config.
2. Add or update the row **in the relevant project's section**.
3. Write the file back.
4. Mention the change in chat: "Cached `copilot_bot_id` = `BOT_kgDO...` for project `<slug>` in github-dev-methodology.config.local.md".

The next session inherits the discovery.

## Adding another project

1. Duplicate the entire `## Project: <slug>` section.
2. Rename the slug (`my-app` → `other-app`).
3. Fill in the values.
4. Optionally switch `active_project` to the new slug.

## Why per-project, not org-wide

Different projects in the same org might have different conventions:

- One project uses Copilot reviews; another uses a named human.
- One project wants a 5-min poll; another wants 15-min.

Per-project sections let each board override defaults without coordinating across the workspace.
