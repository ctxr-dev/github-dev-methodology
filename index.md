# github-dev-methodology — entry point

**ALWAYS read first** when picking up any task in a project that has imported this methodology. The order below is the recommended read order for cold-start.

## Pre-bootstrap auth (run ONCE per developer machine)

The methodology touches GitHub Projects v2, label cascade, branch
protection (where available), issue + native-Type management, and
sometimes auto-creates org-level Issue Types. Each step needs different
`gh` token scopes. To avoid prompting the user multiple times across
the bootstrap, request ALL needed scopes upfront in a single refresh:

```bash
gh auth refresh -h github.com -s read:org,admin:org,project,workflow,admin:repo_hook,admin:org_hook,repo
```

If the user can't grant `admin:org` (not an org admin), drop that scope
and skip the "auto-create native Issue Type" branch in
[`label-taxonomy.md`](label-taxonomy.md). All other bootstrap steps work
without it.

## Per-project configuration

Before doing anything, check whether `.agents/ctxr-dev/github-dev-methodology.config.local.md` exists in the project. It carries:

- The project board URL (`<PROJECT_URL>`).
- The owner / repo names (`<OWNER>`, primary `<REPO>`, sibling repos).
- The default code-review provider (Copilot, named human, or "ask").
- The PR-loop polling interval + max-duration overrides (if any).
- The local Bot node IDs (Copilot, Dependabot) for the consumer org.

If it doesn't exist, create one from [`templates/config.local.md`](templates/config.local.md) and ASK THE USER to fill in the values before proceeding. See [`local-config.md`](local-config.md) for the full schema.

## Topic index

1. [`pr-loop.md`](pr-loop.md) — PR review loop. 5-min cadence, 24h max. Reviewer auto-discovery (Copilot / configured / ask). Exit predicate: all required reviewers approved + no unresolved threads + CI green. ALWAYS resolve threads in the same turn that fixes them.
2. [`commits.md`](commits.md) — Conventional Commits 1.0 (MUST). Reviewer-request via GraphQL `requestReviews` with `botIds` (NOT REST). Discovery snippet for bot node IDs.
3. [`plan-to-issues.md`](plan-to-issues.md) — Recipe for turning a markdown plan into a wired native sub-issue tree on a GitHub Project. Every issue cold-start ready.
3a. [`issue-lifecycle.md`](issue-lifecycle.md) — Single-issue / single-PR flow for non-trivial fixes that don't warrant a sub-issue tree. Six-step contract: create issue → branch (status → `In progress`) → PR with `Closes #N` (status → `In review`) → wait → human merges + closes (status → `Done`) → bundling rules. Status transitions: the agent owns `In progress` and `In review`; the human owns `Done`, the merge, and the close. Covers the auto-close gotcha for non-default-branch merges.
4. [`issue-schema.md`](issue-schema.md) — Canonical body shape. MUST-FOLLOW; validator hard-fails on missing sections.
5. [`label-taxonomy.md`](label-taxonomy.md) — Locked families (`type:*`, `scope:*`, `phase:*`, `release:*`) + project-extensible `area:*`. Cascade install across all repos in the project.
6. [`cold-start.md`](cold-start.md) — How to pick up an issue with zero prior context. The 4-step warm-up sequence.
7. [`agents-orchestration.md`](agents-orchestration.md) — Default pattern for every non-trivial task: push focused work into fresh subagents; orchestrator holds only the plan, decisions, and compacted history; findings collapse on the way up. The umbrella that [`parallel-validation.md`](parallel-validation.md) specialises.
8. [`parallel-validation.md`](parallel-validation.md) — After every plan migration, spawn 3 Plan agents (completeness / dep-graph / cold-start) SCOPED TO TOUCHED ISSUES ONLY. Token economy: don't audit untouched parts of the tree.
9. [`plan-deprecation.md`](plan-deprecation.md) — Once issues exist, the agent auto-minimizes the original plan file to title + 1-paragraph + epic link.
10. [`audit-vs-execute.md`](audit-vs-execute.md) — Investigation findings ≠ approval. Always pause for explicit user "go" before mutating artefacts. PR merge is human-gated.

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

Each script honours the per-project config at `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` (read via the parser at `scripts/lib/config.mjs`).

## Quick reference recipes (for when the agent is in a hurry)

- **New PR cycle:** see `pr-loop.md` → "Loop step-by-step".
- **Migrate a plan to issues:** see `plan-to-issues.md` → "10-step recipe".
- **After plan migration validation:** see `parallel-validation.md` → "3-agent prompt templates".
- **Pick up a cold issue:** see `cold-start.md` → "4-step warm-up".

## Source-of-truth contract

GitHub Project + Issues are the source of truth for multi-issue work in any project that imports this methodology. Local plan files are session-scratch only; they get archived/minimized once their content is migrated to issues. See [`plan-deprecation.md`](plan-deprecation.md).
