# github-dev-methodology - entry point

**ALWAYS read first** when picking up any task in a project that has imported this methodology. The order below is the recommended read order for cold-start.

## Active features (READ FIRST, every session)

This methodology is **opt-in per feature**. The agent never bootstraps a recipe whose feature is off in the active project.

1. Open `.agents/ctxr-dev/github-dev-methodology.config.local.md`.
2. Resolve the active project (see [`local-config.md`](local-config.md) - `--project <slug>` flag > "use project X" instruction > `active_project` key).
3. Read its `### Features` table into a feature map of the 13 flags. (See [`local-config.md`](local-config.md) for the full flag list and the 3 install presets.)
4. For every topic file in the index below, parse the YAML frontmatter:
   - if `feature` is off in the map → **skip the file entirely**
   - if any name in `requires.features` is off → **skip the file entirely**
   - if any key in `requires.config` is empty in the active project → **skip the file entirely** (and surface a one-line warning if the user just asked for something from this file)
5. Inline `> **Skip this section if <flag> is off** ...` notes inside surviving files take precedence within those files.
6. The agent **never** offers to bootstrap a recipe whose `feature` flag is off, and **never** asks the user for config values whose `requires.config` belong only to disabled features.

## Pre-bootstrap auth (run ONCE per developer machine, scope to active features)

Only request the scopes the active features actually need. Take the union across enabled features:

| Feature on | Scopes to add |
|---|---|
| `pr_loop` | `repo`, `workflow` |
| `copilot_review` | `repo` (already covered) |
| `conventional_commits` | `repo` (already covered) |
| `issue_schema` / `issue_lifecycle` | `repo` (already covered) |
| `label_taxonomy` | `repo` (already covered); plus `admin:org` **only** if the user picks the auto-create-native-Issue-Type branch in [`label-taxonomy.md`](label-taxonomy.md) |
| `plan_to_issues` / `parallel_validation` / `cold_start` / `plan_deprecation` | `project`, `read:org` |

Example: for the `pr-only` preset, the refresh is just:

```bash
gh auth refresh -h github.com -s repo,workflow
```

For the `full` preset (assuming the user wants the option to auto-create org Issue Types):

```bash
gh auth refresh -h github.com -s repo,workflow,project,read:org,admin:org
```

If the user can't grant `admin:org` (not an org admin), drop that scope and skip the "auto-create native Issue Type" branch in [`label-taxonomy.md`](label-taxonomy.md). All other bootstrap steps work without it.

## Per-project configuration

Before doing anything else, check whether `.agents/ctxr-dev/github-dev-methodology.config.local.md` exists in the project. It carries:

- The `### Features` table (the 13 flags driving everything below).
- The active project values (owner, primary repo, sibling repos).
- The project board URL (used only when board features are on).
- The default code-review provider (Copilot, named human, or "ask").
- The PR-loop polling cadence / max-duration overrides (if any).
- Cached Bot node IDs (Copilot, etc.) for the consumer org.

If it doesn't exist, create one from [`templates/config.local.md`](templates/config.local.md) and ASK THE USER to fill in at least the `active_project` slug + the `### Features` table for one project section before proceeding. When `pr_loop` is on, this same bootstrap does the ONE-TIME reviewer-set discovery: enumerate the candidate reviewers (Copilot via `suggestedActors`, capturing `copilot_bot_id`; humans/teams via collaborators / CODEOWNERS / `suggestedActors`), ask the user once which to request on every PR and which humans must approve, and persist `reviewers` + `required_reviewers`. This is the only reviewer ask; [`pr-loop.md`](pr-loop.md) reads the persisted set thereafter. See [`local-config.md`](local-config.md) for the full schema and the 3 install presets.

## Recommended subagents (offer ONCE, at bootstrap)

The `agents_orchestration` recipe fans work out to three small, tool-agnostic subagents that are read-only by prompt policy (not tool restriction):

| Agent | Role |
|---|---|
| `agent-codebase-explorer` | Locates code (where-is-X / what-references-Y) during planning fan-out. |
| `agent-plan-reviewer` | Adversarially reviews a plan before you commit to it (powers the optional plan-review gate). |
| `agent-implementation-auditor` | Audits built work against its plan at merge-prep (powers the optional conformance-review gate). |

They are optional but recommended. As part of the SAME bootstrap that creates the config (above), ask the user ONCE whether to install them at user scope so they are available in every project. On agreement, install globally for the user:

```bash
npx @ctxr/kit install --user @ctxr/agent-codebase-explorer @ctxr/agent-plan-reviewer @ctxr/agent-implementation-auditor
```

If the user declines, skip it: the orchestrator still runs the fan-out and the optional review gates inline. Do NOT re-ask in later sessions (this is a one-time bootstrap offer, like the reviewer-set discovery above). The two review agents earn their keep under `subagent_review` (on in the `single-issue` and `full` presets); see [`agents-orchestration.md`](agents-orchestration.md) for how they are used.

## Topic index (each entry is gated; check frontmatter before reading)

Annotations: `feature: <flag>` (the flag that enables this file) · `in: <presets>` (which install presets enable it by default).

1. [`pr-loop.md`](pr-loop.md) · `feature: pr_loop` · `in: pr-only, single-issue, full`. PR review loop. Watches a SET of individual reviewer logins (Copilot + humans) from the persisted `reviewers` config; a team is requested for review but tracked via its member logins. 60s default cadence (configurable), **foreground polling** (the agent keeps the loop in the foreground via the `gh_pr_review_watch` tool or the `scripts/pr-review-watch.mjs` long-poll; no callbacks, no wake-ups). 24h max. Exit predicate: every configured reviewer has re-reviewed HEAD and is green (no unresolved non-outdated thread authored by them) + required approvals present + CI green. ALWAYS resolve threads in the same push that fixes them.
2. [`commits.md`](commits.md) · `feature: conventional_commits` · `in: pr-only, single-issue, full` - Conventional Commits 1.0. Reviewer-request via GraphQL `requestReviews` with `botIds` (the Copilot section is gated on `copilot_review`).
3. [`agents-orchestration.md`](agents-orchestration.md) · `feature: agents_orchestration` · `in: pr-only, single-issue, full` - Default pattern for every non-trivial task: push focused work into fresh subagents; orchestrator holds only the plan, decisions, and compacted history. The umbrella that `parallel-validation.md` specialises. Also hosts the fan-out resilience discipline (full-toolset, never-halt subagents; spawn-time bad-schema risks fixed at the connector layer, not by restricting agents) and the optional plan-review / conformance-review gates (gated by `subagent_review`, an inline section).
4. [`audit-vs-execute.md`](audit-vs-execute.md) · `feature: audit_vs_execute` · `in: pr-only, single-issue, full` - Investigation findings ≠ approval. Always pause for explicit user "go" before mutating artefacts. PR merge is human-gated.
5. [`issue-schema.md`](issue-schema.md) · `feature: issue_schema` · `in: single-issue, full` - Canonical issue body shape. MUST-FOLLOW; validator hard-fails on missing sections.
6. [`issue-lifecycle.md`](issue-lifecycle.md) · `feature: issue_lifecycle` · `in: single-issue, full` - Single-issue / single-PR flow: create issue → branch (status → `In progress`) → PR with `Closes #N` (status → `In review`) → wait → human merges + closes (status → `Done`) → bundling rules. The agent owns `In progress` and `In review`; the human owns `Done`, the merge, and the close.
7. [`label-taxonomy.md`](label-taxonomy.md) · `feature: label_taxonomy` · `in: full` - Locked families (`type:*`, `scope:*`, `phase:*`, `release:*`) + project-extensible `area:*`. Cascade install across all repos in the project. Native Issue Type mapping (optional admin:org branch).
8. [`plan-to-issues.md`](plan-to-issues.md) · `feature: plan_to_issues` · `in: full` - Recipe for turning a markdown plan into a wired native sub-issue tree on a GitHub Project. Every issue cold-start ready.
9. [`parallel-validation.md`](parallel-validation.md) · `feature: parallel_validation` · `in: full` - After every plan migration, spawn 3 Plan agents (completeness / dep-graph / cold-start) SCOPED TO TOUCHED ISSUES ONLY. Token economy: don't audit untouched parts of the tree.
10. [`plan-deprecation.md`](plan-deprecation.md) · `feature: plan_deprecation` · `in: full` - Once issues exist, the agent auto-minimizes the original plan file to title + 1-paragraph + epic link.
11. [`cold-start.md`](cold-start.md) · `feature: cold_start` · `in: full` - How to pick up an issue with zero prior context. The 4-step warm-up sequence.

## Validation scripts

Live under [`scripts/`](scripts/). Run them from the methodology directory:

```bash
cd .agents/ctxr-dev/github-dev-methodology/scripts
npm install
node validate-tree.mjs <ROOT_ISSUE_URL>
node validate-issue-schema.mjs <OWNER>/<REPO>
node validate-labels.mjs <OWNER>
node diff-plan.mjs <PLAN_FILE> <PROJECT_URL>
```

Each script honours the per-project config at `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` (read via the parser at `scripts/lib/config.mjs`). Scripts do NOT self-gate on features - running a validator manually is a deliberate user action. Skip a script if its underlying feature is off.

## Quick reference recipes (for when the agent is in a hurry)

- **New PR cycle:** see `pr-loop.md` → "Loop step-by-step". (`pr_loop`)
- **Migrate a plan to issues:** see `plan-to-issues.md` → "10-step recipe". (`plan_to_issues`)
- **After plan migration validation:** see `parallel-validation.md` → "3-agent prompt templates". (`parallel_validation`)
- **Pick up a cold issue:** see `cold-start.md` → "4-step warm-up". (`cold_start`)

## Source-of-truth contract

When the `plan_to_issues` / `issue_lifecycle` features are on, GitHub Project + Issues are the source of truth for multi-issue work. Local plan files are session-scratch only; they get archived/minimized once their content is migrated to issues (see [`plan-deprecation.md`](plan-deprecation.md)). Under the `pr-only` preset, plan files stay local - there is no project tree to migrate to.
