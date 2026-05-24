# Per-project local config

The methodology stays project-agnostic. Per-project values live in a gitignored markdown file at `.agents/ctxr-dev/github-dev-methodology.config.local.md`. One file can track **one or many GitHub Projects** - useful when a single workspace participates in several boards.

Every project section also carries a `### Features` table that determines which methodology recipes the agent applies. Most projects don't need every feature, so the methodology is **opt-in per feature**, with three install presets (`pr-only` / `single-issue` / `full`) for the common shapes.

## Schema

```markdown
# github-dev-methodology.config.local.md (gitignored)

## Active

| Key | Value |
|---|---|
| `active_project` | <slug-of-a-Project-section-below> |

## Project: <slug-1>

### Features

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
| `reviewers` | comma-separated INDIVIDUAL reviewer logins watched on every PR: `copilot`, `<github-login>`. The watch matches review-author logins, so a `<team-slug>` is never tracked (it would stay pending forever): you may still request a team for review, but list the member logins you expect to review here. Value `ask` triggers the first-run discovery + multi-select (see "How the agent reads it"). |
| `required_reviewers` | subset of `reviewers` whose `APPROVED` gates the exit predicate (humans only; bots have no `APPROVED` state). May be empty. |
| `pr_loop_wait_for` | `any` (default) \| `smart` \| `all` \| `quorum:N`. Selects which reviewer transitions wake the loop between cycles (does NOT relax the done predicate). |
| `copilot_bot_id` | BOT_kgDOXXXXXX (per-installation; discover via commits.md snippet) |
| `pr_loop_poll_seconds` | 60 (override the default 60s cadence) |
| `pr_loop_max_hours` | 24 (override default 24h max-no-progress) |

> **Legacy `default_reviewer` is still honored as a one-element fallback** when `reviewers` is empty (doc/agent contract; nothing in the parser reads it, so the agent applies the fallback). Prefer `reviewers`; migrate old configs by moving the single value into the `reviewers` set.

### Dev-loop modes

| Key | Value |
|---|---|
| `default_dev_loop_mode` | autonomous \| interactive \| handoff |

### Plan-deprecation policy

| Key | Value |
|---|---|
| `plan_post_migration` | minimize (default) \| delete |

## Project: <slug-2>

... (duplicate the section above; H3 subsections are visual grouping only - the parser pulls keys from any table row under the `## Project: <slug>` H2)
```

`## Active` is parsed for the `active_project` key; that's the project used when no `--project` override is passed. Slugs are user-chosen labels (`my-app`, `web`, `infra`) - keep them short and shell-safe.

> **Polling is always foreground.** There is no `polling_paradigm` flag any more (formerly `wakeup | background`); both options are gone. See [`pr-loop.md`](pr-loop.md)'s "Polling cadence" section.

## The 12 feature flags

Each row in the `### Features` table maps to one (and only one) topic doc. Flags default to `false` if the row is missing.

| Flag | Gates |
|---|---|
| `pr_loop` | `pr-loop.md` (the canonical PR review loop) |
| `copilot_review` | the Copilot-discovery + GraphQL `requestReviews` sections inside `commits.md` and `pr-loop.md`. Off → fall back to plain `gh pr edit --add-reviewer <login>`. |
| `conventional_commits` | `commits.md` (commit message format spec) |
| `agents_orchestration` | `agents-orchestration.md` (orchestrator + fresh-subagent pattern; universal) |
| `audit_vs_execute` | `audit-vs-execute.md` (findings ≠ approval; PR merge is human-gated). **Disabling this removes the merge gate and bulk-edit safeguards - not recommended.** |
| `issue_schema` | `issue-schema.md` (canonical issue body shape + validator contract) |
| `issue_lifecycle` | `issue-lifecycle.md` (single-issue / single-PR flow) |
| `label_taxonomy` | `label-taxonomy.md` (locked label families + native Issue Type mapping) |
| `plan_to_issues` | `plan-to-issues.md` (markdown plan → wired sub-issue tree) |
| `parallel_validation` | `parallel-validation.md` (3-agent post-migration audit) |
| `plan_deprecation` | `plan-deprecation.md` (auto-minimize plan files post-migration) |
| `cold_start` | `cold-start.md` (4-step warm-up reading an existing issue + board state) |

## The 3 install presets

The install prompt asks once: "Which preset?" Pick the closest one; flip individual flags later.

| Preset | What's on | When to pick |
|---|---|---|
| `pr-only` | `pr_loop`, `copilot_review`, `conventional_commits`, `agents_orchestration`, `audit_vs_execute` | You just want the PR loop + Copilot review. No issues, no project board. Skips: every issue/project/label/migration recipe. |
| `single-issue` | `pr-only` + `issue_schema`, `issue_lifecycle` | You file issues per fix but don't run a project board. Adds the canonical body shape + single-issue/single-PR flow. |
| `full` | all 12 | You run a GitHub Project with the full methodology: sub-issue trees, label taxonomy, plan migrations, post-migration validation, cold-start, plan deprecation. |

Default values for fields not used by your preset can be left as `<not used: pr-only>` (or your preset's name). When you upgrade the preset later, fill them in.

## Frontmatter contract

Every feature-gated topic doc starts with a YAML frontmatter block:

```yaml
---
feature: <flag-name>
requires:
  features: [<other_flag>, ...]   # other flags that must ALSO be on
  config:   [<config_key>, ...]   # config keys whose values must be non-empty
---
```

Files with no frontmatter (`README.md`, `AGENTS.md`, `index.md`, `local-config.md`) are always-on entry points and schema docs.

**Agent rule (see [`index.md`](index.md) preamble for the full text):** before reading any topic file, parse its frontmatter. Skip the file entirely if its `feature` is off, any `requires.features` entry is off, or any `requires.config` key is empty in the active project. Inline `> **Skip this section if <flag> is off** ...` notes inside surviving files take precedence within those files.

Precedence: **whole-file gate** (frontmatter) > **inline section gate** (`> **Skip ...**` callout) > recipe step.

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
2. **Explicit instruction to the agent** - "use project `<slug>` for this session". The agent loads the named section and proceeds.
3. **`active_project` in the `## Active` section** (default). Used when nothing else is specified.

## How the agent reads it

At session start (or before any methodology recipe runs), the agent:

1. Checks if `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` exists.
2. If yes: reads the file, resolves which project section to use (per the precedence above), parses the `### Features` table into a flag map, and holds the project's keys + feature map for the session.
3. If no: creates it from `templates/config.local.md` and **asks the user** to (a) pick a preset (`pr-only` / `single-issue` / `full`), (b) fill in at least one `## Project: <slug>` section with the `active_project` pointer.
4. **Reviewer-set discovery (one time, when `pr_loop` is on and `reviewers` is unset or `ask`).** As part of bootstrap, the agent discovers the candidate reviewers ONCE, asks the user to choose, and persists the result so no later step re-asks:
   - **Discover candidates.** Copilot via the `suggestedReviewers` / `suggestedActors` surface (and, when found, capture `copilot_bot_id` per the [`commits.md`](commits.md) snippet); humans and teams via the repo's collaborators, `CODEOWNERS`, and `suggestedActors`.
   - **Ask the user (multi-select)** which of those reviewers to request on EVERY PR, and which of the chosen humans MUST approve before merge.
   - **Persist** the answer as `reviewers` (the full set), `required_reviewers` (the must-approve humans), and `copilot_bot_id` (if Copilot was chosen) in the active project's section. This is the only reviewer ask; [`pr-loop.md`](pr-loop.md) just reads the persisted set thereafter.

## Why markdown not JSON

- Human-readable; user edits in their IDE without learning a schema.
- Plain text, no JSON parser needed.
- Per-project H2 sections + H3 sub-tables read top-to-bottom like a small dashboard.
- Comments-as-context easy: `<!-- override because reasons -->` works inline.

## Why gitignored

The values are user- and machine-specific:

- The org might differ if the user works in multiple orgs.
- The Copilot bot ID is per-org-per-repo-installation.
- The reviewer set is a per-project, often personal, preference.
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

1. Duplicate the entire `## Project: <slug>` section (including the `### Features` H3).
2. Rename the slug (`my-app` → `other-app`).
3. Fill in the values; adjust the feature flags for the new project's needs.
4. Optionally switch `active_project` to the new slug.

## Why per-project, not org-wide

Different projects in the same org might have different conventions:

- One project uses Copilot reviews; another uses a named human plus a team.
- One project wants a 60s poll; another wants 5-min.
- One project runs `pr-only`; another runs `full` with a project board.

Per-project sections let each board override defaults - including the feature set - without coordinating across the workspace.
