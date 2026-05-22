---
feature: plan_deprecation
requires:
  features: [plan_to_issues]
  config: []
---

# Plan deprecation (post-migration)

After a plan is migrated to GitHub issues, the plan markdown file becomes obsolete as a source of truth. Issues are now canonical. The plan file gets minimized so future readers don't accidentally consult stale content.

## What "minimized" means

The plan file is REPLACED in-place with a 5-line skeleton:

```markdown
# <Original Plan Title>

> **Status:** Migrated to GitHub issues on <YYYY-MM-DD>.
> **Canonical roadmap:** [<Epic Title>](<epic-url>).

This plan was migrated to a wired native sub-issue tree on <PROJECT_URL>. The full pre-migration content is recoverable from git history at the pre-migration HEAD (`git log --all --source -- <plan-file-path>` to find the SHA). Future planning lives in the issue tree; this file is kept only as a redirect for inbound links.
```

Concrete example:

```markdown
# v2 Bundle redesign plan

> **Status:** Migrated to GitHub issues on 2026-04-26.
> **Canonical roadmap:** [Epic: v2 enhancements](https://github.com/ctxr-dev/agent-staff-engineer/issues/17).

This plan was migrated to a wired native sub-issue tree on https://github.com/orgs/ctxr-dev/projects/1. The full pre-migration content is recoverable from git history (`git log --all --source -- plans/v2-bundle.md` to find the pre-migration commit). Future planning lives in the issue tree; this file is kept only as a redirect for inbound links.
```

## When the agent minimizes the plan file

This is the **final step of the plan-to-issues migration recipe** (see [`plan-to-issues.md`](plan-to-issues.md), Step 11). It runs AFTER:

- All issues are created.
- The native sub-issue tree is wired.
- Project board fields are populated.
- The 4 validation scripts pass.
- The 3 parallel Plan agents have audited (TOUCHED-only).
- Highest-leverage polish has been applied.

THEN: the agent rewrites the plan file in-place to the minimal skeleton + commits as `docs: migrate plan to <epic-link>`.

## Why automatic, not manual

- Reduces drift. The plan file would otherwise rot — unchanged file with stale content next to a moving issue tree.
- Single canonical source of truth (the issue tree).
- Git history preserves the original. Recovery is `git show <pre-migration-sha>:<plan-file-path>` if anyone needs the original.

## Edge cases

- **Plan never migrated to issues** (e.g. it's a session-scratch plan, never published). Skip this step. Plan file stays as session scratch.
- **Plan partially migrated** (some sections became issues, others didn't). Don't minimize until full migration. Risk of losing un-migrated content otherwise.
- **Multiple plan files for the same epic**. Minimize each; each gets the same epic-link redirect.

## Recovery

If a future session needs the full original plan:

```bash
# Find the pre-deletion commit:
git log --all --source -- <plan-file-path>

# Read the file at that revision:
git show <SHA>:<plan-file-path>
```

This is sufficient for archaeology. The minimized version doesn't need to carry redundant content.

## Don't fully delete

The methodology recommends MINIMIZE (replace content) over DELETE (remove file) because:

- Inbound links to the file (in old commits, in slack messages, etc.) still resolve to a "this is a redirect" page.
- The minimized file is searchable: `grep -r "Migrated to" plans/` finds every retired plan.
- Cost is 5 lines per retired plan; trivial.

If a project explicitly prefers full deletion: override in `.agents/ctxr-dev/github-dev-methodology.config.local.md` with `plan_post_migration: delete`.
