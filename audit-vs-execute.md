---
feature: audit_vs_execute
requires:
  features: []
  config: []
---

# Audit vs execute — investigation findings ≠ approval

When the user asks for an investigation or audit, the **deliverable is the findings**, not the execution. Findings are discussion material. Pause for explicit user "go" before mutating any artefact.

## The rule

If a finding points toward a change ("drop X, replace Y with Z, bypass A"):

1. **Present the findings.**
2. **Propose the change as an option.**
3. **Wait for explicit "yes / go / do it" before touching any artefact.**

## Particularly important when blast radius is large

A "thoughtful finding" is NOT licence to:

- Edit issue bodies in bulk.
- Rewrite plan files.
- Delete or close issues.
- Change project-board fields.
- Push commits or open PRs.
- Modify memory entries.

Each of these has cumulative blast radius. Reverting them is non-trivial.

## Single-step low-risk exception

OK to act without explicit go on:

- Typo fixes in artefacts you just edited and are still mid-task on.
- Label corrections caught during a pass the user already approved.
- Pulling additional context for the user's question (read-only).

NOT OK without explicit go:

- "While I was at it, I also closed issues that looked stale."
- "I noticed the wiki could be bypassed; here's the rewrite."
- "Findings recommended X; I went ahead and applied X."

## PR merge is human-gated

EVEN ON SELF-MERGE-AUTHORIZED REPOS where you have permissions, merge is human-gated. The user's explicit "merge" / "ship it" / "go ahead" is required.

Notifications like:
- "Review ready"
- "New comments on PR"
- "Copilot replied"
- "CI is green"

Are signals to **act on the review** (read, fix, push, resolve), **NEVER** signals to merge.

Branch protection encodes the same rule. If protection blocks your merge, the rule was sound — don't try to bypass.

## Default phrasing when uncertain

When findings have ANY chance of being a change-recommendation rather than a discussion point, end with:

> "Based on findings, I'd recommend X. Confirm before I apply?"

And then **actually wait**. Don't apply X "while waiting" or "to save a turn."

## Why this matters

The user explicitly tracks what they've approved. Surprise mutations that look reasonable in isolation accumulate into "the agent did things I didn't ask for" — which erodes trust and forces the user to audit every artefact for unauthorized changes.

Token cost of pausing-to-ask is trivial. Cost of unwinding unauthorised changes spans multiple artefacts and multiple sessions.

## When this rule does NOT apply

- The user said "do everything" / "execute the plan" / "make all the changes" — explicit blanket approval.
- The user is operating in autonomous mode and has explicitly told you to be autonomous on this task.
- The change is reversible AND part of an obvious next step in a flow the user already approved (e.g. ticking checkboxes after committing the work they map to).

When in doubt: pause and ask. The cost is one turn of latency; the upside is preserved trust.
