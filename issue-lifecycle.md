---
feature: issue_lifecycle
requires:
  features: [issue_schema]
  config: [primary_repo]
---

# Issue lifecycle for single-fix work

The canonical six-step contract for non-trivial fixes and small features. Applies to any change that is too small for the [`plan-to-issues.md`](plan-to-issues.md) sub-issue tree treatment but still warrants a durable issue record.

For multi-step plans that cover several related changes, use [`plan-to-issues.md`](plan-to-issues.md) instead. This file is for the single-issue, single-PR flow.

## When this flow applies

- A reproducible bug with a clear scope.
- A small feature that fits in one PR.
- A focused refactor with a defined boundary.

If the work fans out into multiple PRs or multiple workstreams, escalate to the plan-to-issues recipe and create a sub-issue tree.

## Project-board status transitions (summary)

If the issue is on a GitHub Project board, the agent moves it through exactly two transitions; the human owns the third:

- **Todo / Backlog → In progress** — set when the agent starts work on the issue (typically right before / after step 2: branch creation).
- **In progress → In review** — set when the dev loop finishes and the PR is open and review-ready (end of step 3).
- **In review → Done** — **HUMAN ONLY.** Triggered by the human merging the PR and closing the issue. The agent never sets `Done` and never merges the PR. See [`audit-vs-execute.md`](audit-vs-execute.md).

These transitions are reflected inline in the steps below.

## The six-step contract

### 1. Create the GitHub issue FIRST

```bash
gh issue create --repo <OWNER>/<REPO> \
  --title "<type>(<scope>): <subject>" \
  --body "$(cat <<'EOF'
## Context
Which symptom / log / observation triggered the work.

## Root cause
file:line references and a short mechanism explanation.

## Proposed fix
Touch list and a "why this is the right shape" paragraph.

## Verification
How we'll know it worked (manual repro, test added, log check).

## Priority rationale
bug vs latent vs tradeoff, and who is impacted.
EOF
)"
```

Issue body MUST follow [`issue-schema.md`](issue-schema.md). The validator hard-fails on missing sections.

### 2. Branch off main, name tied to the issue

```bash
git checkout main && git pull
git checkout -b <type>/issue-<N>-<short-slug>   # e.g. fix/issue-42-null-deref
```

**Set project-board status: `In progress`.** Work has now started on a known issue, so the board MUST reflect it. If the issue is on a Project, update the `Status` field via GraphQL `updateProjectV2ItemFieldValue`. Idempotent — safe to re-run.

### 3. Run the PR loop with `Closes #<N>` in the body

Drive [`pr-loop.md`](pr-loop.md) end to end. The PR body MUST carry a closing keyword footer:

```
Closes: <OWNER>/<REPO>#<N>
```

Use the fully-qualified `<OWNER>/<REPO>#<N>` form when the PR and issue may live in different repos; the bare `Closes #<N>` form is fine when they share a repo.

**Set project-board status: `In review`** once the dev loop's exit predicate holds (PR open, CI green, reviewers requested) and the agent has handed off to the human merge gate. This is the agent's last status mutation on the item.

### 4. Wait for the user to confirm the merge

**Do NOT close the issue pre-emptively.** The PR loop's exit predicate hands off to a human merge decision (see [`audit-vs-execute.md`](audit-vs-execute.md)). After reporting the PR as ready, wait for the user to say it's merged.

**PR merge is human-only.** The agent never runs `gh pr merge`, never clicks the merge button, and never auto-promotes the project item to `Done`. The human merges the PR and the human moves the board status to `Done` (or lets the issue close auto-promote it, depending on project automation).

### 5. Close the issue explicitly after confirmation

**Closing the issue is human-owned.** The human reviews the merged work, confirms it's shipped, and closes the issue. The agent may *propose* the close-comment text (below) for the human to paste, but does not run `gh issue close` autonomously — closure is a `Done`-equivalent decision and falls under the same human gate as the PR merge (see [`audit-vs-execute.md`](audit-vs-execute.md)).

Suggested close-comment template (idempotent — closing an already-closed issue is a no-op for state, but the comment still posts):

```bash
gh issue close <N> --repo <OWNER>/<REPO> \
  --comment "Shipped in <merged-commit-SHA> via #<PR_NUM>."
```

This turns the issue into a durable postmortem-style record. Future readers get a single URL with: the symptom, the root cause, the fix shape, the verification, AND the merged commit reference.

### 6. Bundling rules

- **Multiple related fixes** can share one issue. Call them out as a checklist in the issue body and tick them off as commits land.
- **Multiple unrelated fixes** get one issue + one PR each. Never bundle independent fixes into one PR — review feedback gets tangled, partial reverts get expensive, and the postmortem trail breaks.
- **A batch of issues** approved together: open them in priority order, one PR per issue, sequentially.

## Auto-close gotcha (the reason for step 5)

GitHub's `Closes #N` keyword auto-closes the issue ONLY when the PR merges into the **default branch** (typically `main`). Edge cases that DO NOT trigger auto-close:

- PR merged into a release branch (e.g. `release/v2`) that later gets merged to main itself.
- PR description edited to add `Closes #N` AFTER the merge.
- The issue lives in a different repo than the PR (cross-repo references are advisory, not auto-closing).
- The PR is closed without merging, and a different commit (manual cherry-pick) ships the fix.

In all four cases, the issue lingers as an unclosed artifact unless step 5 runs explicitly. That is why step 5 is mandatory even when GitHub appears to have closed the issue — the comment is the durable record, and verifying state is `CLOSED` is cheap insurance.

## Cross-references

- [`pr-loop.md`](pr-loop.md) — the PR-side mechanics this flow drives.
- [`commits.md`](commits.md) — Conventional Commits + the `Closes:` footer form.
- [`issue-schema.md`](issue-schema.md) — required sections in the issue body.
- [`plan-to-issues.md`](plan-to-issues.md) — escalation path when a single issue isn't enough.
- [`audit-vs-execute.md`](audit-vs-execute.md) — why steps 4 and 5 are gated on the human's "go".
