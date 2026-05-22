---
feature: parallel_validation
requires:
  features: [issue_schema, plan_to_issues]
  config: [primary_repo]
---

# Parallel validation pattern

After every plan migration to issues, spawn 3 Plan agents in parallel to audit the result. **Scope: TOUCHED issues only.** Don't re-audit untouched portions of the tree — token economy.

## Why

Single-agent self-review misses gaps the same agent created. Parallel audits with different perspectives catch:

- Missing artefacts (an issue the plan promised that wasn't created).
- Dependency-graph defects (cycles, orphans, mis-rooted leaves).
- Cold-start gaps (an issue body that's missing context a fresh session would need).

3 agents is the sweet spot — more is diminishing returns, fewer leaves audit blind spots.

## When to invoke

After ANY of:

- Plan-to-issues migration completes (final step before declaring "done").
- Adding ≥ 3 new issues at once.
- Major body updates across ≥ 5 issues.
- Closing 3+ issues as superseded.

Skip if you only touched 1-2 issues — the validators are sufficient at that scale.

## Scope: TOUCHED issues only

The agents receive an explicit list of issues they SHOULD audit. They don't crawl the whole tree. Examples of "touched":

- Issues created during this migration session.
- Issues whose bodies were edited.
- Issues whose project-board fields were changed.
- Issues whose state transitioned.

Don't pass: untouched parent epics, sibling repos that weren't modified, closed-long-ago issues.

## Prompt templates

### Agent 1 — Completeness audit

```text
You are auditing a just-completed migration. Plan reference: <plan-file-path>.

Touched issues (DO NOT audit beyond this list):
- <OWNER>/<REPO>#<NUM> "<title>"
- <OWNER>/<REPO>#<NUM> "<title>"
- ...

For each touched issue:
1. Read it via `gh issue view <NUM> --repo <OWNER>/<REPO> --json title,body,labels,state`.
2. Cross-reference against the plan file: was this issue promised? Is its body content consistent with the plan's promised content?
3. Specifically check: missing labels, missing metadata header fields (Priority / Size / Status / Blocked-by / Blocks), missing sections (Why / Action items / Acceptance / Implementation pointers / Test plan).

Report (≤ 600 words):
- Issues with PASS (no gap).
- Issues with FAIL (specific gap; ≤ 1-line per issue).
- Plan-promised artefacts that don't exist in GH (most important — these are real gaps).

Read-only. No file edits.
```

### Agent 2 — Dependency-graph validation

```text
Validate the native sub-issue tree for the touched issues only.

Touched issues:
- <OWNER>/<REPO>#<NUM>
- ...

For each issue:
1. Walk the parent chain via GraphQL `Issue.parent` until null. Report the chain.
2. Verify: chain terminates at <ROOT_EPIC_URL> within ≤ 4 hops.
3. Detect cycles: same issue appears twice in the chain.
4. Detect orphans: issue has no parent AND isn't the root.

Also for each issue, check downstream:
- Pull `subIssues` via GraphQL.
- For each child, verify the child's `Blocked by:` body line cites this issue (bidirectional consistency).

Report (≤ 500 words): per-issue verdict (PASS / cycle / orphan / mis-rooted / asymmetric-block). Cite real issue numbers.

Read-only.
```

### Agent 3 — Cold-start readiness

```text
Spot-check 3-5 issues from the touched list. Imagine a fresh agent opens each one with zero prior context. Could they execute?

Touched issues to sample (pick 3-5; lean toward implementation issues, not epics):
- <OWNER>/<REPO>#<NUM>
- ...

For each sampled issue, score:
A. Could a fresh engineer extract: WHY this exists, WHAT done looks like, WHICH files to touch, WHAT blocks them, WHAT downstream depends?
B. Do all `#NN` cross-refs resolve to real issues?
C. Does the body follow the canonical schema (Metadata header + Why + Action items + Acceptance + Implementation pointers + Test plan)?
D. Are file paths concrete? Are tool names exact? No floating placeholders ("the audit report", "vX.Y.Z")?

Report (≤ 700 words): per-issue verdict (cold-start-ready: yes/no) + the strongest gap if any. End with: how many of N pass; common patterns of weakness; top 3 highest-leverage fixes.

Read-only.
```

## After the agents return

Apply highest-leverage findings BEFORE declaring the migration done. Common quick wins:

- Add missing `Blocks:` lines to metadata headers.
- Resolve ambiguous placeholders (`vX.Y.Z` → concrete version pointer).
- Add missing `Test plan` sections.
- Replace sprint-IDs (`MCP-6`) with real `#NN` references in tables.

Then report to the user with a summary: "X new issues, Y body updates, Z sub-issue links, audited 3-ways, polished N issues, all green."

## Token-economy notes

- The agents are read-only (no file mutations). All findings come back as text reports for the orchestrator (you) to act on.
- Pass each agent ONLY the touched-issue list, not the full project tree.
- Each agent's report capped at ~600-700 words. Aggregate ≤ 2k words total. Cheap.
