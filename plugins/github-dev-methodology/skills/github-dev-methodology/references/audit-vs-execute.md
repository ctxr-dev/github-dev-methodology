---
feature: audit_vs_execute
requires:
  features: []
  config: []
---

# Audit vs execute: findings are not approval

When the owner asks for an investigation or audit, the deliverable is the findings. Findings are material for discussion. Pause for an explicit "go" before you change any artifact.

## The rule

If a finding points toward a change ("drop X, replace Y with Z, bypass A"):

1. Present the findings.
2. Propose the change as an option.
3. Wait for an explicit "yes", "go" or "do it" before you touch anything.

## When the blast radius is large

A well-argued finding is not permission to:

- Edit issue bodies in bulk.
- Rewrite plan files.
- Delete or close issues.
- Change project board fields.
- Push commits or open PRs.
- Modify memory entries.

Each of these has a cumulative effect, and reverting is not simple.

## Low-risk exception

You may act without an explicit go on:

- Typo fixes in artifacts you just edited and are still working on.
- Label corrections found during a pass the owner already approved.
- Extra read-only context for the owner's question.

You may not act on:

- "While I was there, I closed issues that looked stale."
- "I noticed the wiki could be bypassed, so I rewrote it."
- "The findings recommended X, so I applied X."

## Merging is decided by merge authority

Merge authority is set in the repo config (`merge.authority`, see [`configuration.md`](configuration.md)). It is the only thing that lets an agent merge. Before any `gh pr merge`, enabling auto-merge, adding a PR to a merge queue, or `gh stack merge`, run:

```bash
gdm pr can-merge <PR>
```

| Exit code | Meaning | Agent action |
|---|---|---|
| 0 | Merge allowed. | Merge. |
| 3 | PR is not ready (reviews, threads or CI). | Keep iterating. Do not merge. |
| 4 | Needs the owner: authority is `human`, or scope needs explicit instruction. | Report "ready for owner" and stop. |

- `human` (the default): the agent never merges. The owner merges.
- `scoped`: the agent may merge only what the listed `scopes` allow. `dependabot-green` allows a ready PR authored by `dependabot[bot]` or `renovate[bot]`. `session-instruction` needs the owner's explicit instruction in this session; without it the command exits 4.
- `autonomous`: the agent may merge a ready PR.

On Claude Code and OMP a hook enforces this and blocks the merge command. On Codex the hook is best effort and fails open. On other clients nothing enforces it, so the rule is yours to keep. See [`installation.md`](installation.md).

These notifications are signals to act on the review (read, fix, push, resolve). They are never a signal to merge:

- "Review ready."
- "New comments on PR."
- "Copilot replied."
- "CI is green."

Branch protection encodes the same rule. If protection blocks your merge, the rule was sound. Do not try to bypass it.

## Default phrasing when unsure

If a finding could be a change recommendation rather than a discussion point, end with:

> "Based on the findings, I would recommend X. Confirm before I apply it?"

Then wait. Do not apply X "while waiting" or "to save a turn".

## Why this matters

The owner tracks what they approved. Surprise changes that look reasonable on their own add up to "the agent did things I did not ask for", and the owner has to audit every artifact. Pausing costs one turn. Unwinding unapproved changes costs several artifacts and several sessions.

## When this rule does not apply

- The owner said "do everything", "execute the plan" or "make all the changes": explicit blanket approval.
- The owner told you to be autonomous on this task.
- The change is reversible and part of an obvious next step in a flow the owner already approved, such as ticking checkboxes after committing the work they map to.

When in doubt, pause and ask.

## Related

- [`pr-loop.md`](pr-loop.md): the exit predicate that makes a PR ready.
- [`issue-lifecycle.md`](issue-lifecycle.md): who owns each status change.
