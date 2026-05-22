---
feature: issue_schema
requires:
  features: []
  config: []
---

# Canonical issue body schema (MUST-FOLLOW)

Every issue created via the methodology MUST follow this exact body shape. The validator at `scripts/validate-issue-schema.mjs` hard-fails on missing sections.

## The schema

```markdown
> **Part of:** <OWNER>/<REPO>#<EPIC_OR_UMBRELLA_NUM> (<short label>)
> **Sprint umbrella:** Sprint <X> (#<NUM>)        [optional; only if a sprint exists]
> **Priority:** P0|P1|P2|P3 · **Size:** S|M|L|XL · **Status:** Pending|In flight|Blocked|Backlog|Done
> **Blocked by:** [#<NUM>](<URL>), [#<NUM>](<URL>) [optional; omit when none]
> **Blocks:** [#<NUM>](<URL>), [#<NUM>](<URL>) [optional; downstream visibility]

## Why this exists

<1-2 paragraphs of rationale. WHY does this issue need to exist? What's the problem? What's the user-visible outcome?>

## Action items

- [ ] <concrete checkbox 1>
- [ ] <concrete checkbox 2>
- [ ] ...

## Acceptance criteria

<How a future session knows the work is done. Specific, machine-checkable where possible (e.g. "X file exists", "Y command exits 0", "Z test passes").>

## Implementation pointers

- File: `path/to/file.mjs`
- Reference: PR #N, commit `<sha>`, sibling issue `<OWNER>/<REPO>#<NUM>`
- Library: `@external/package` (link to docs)

## Test plan / Verification

- <How to validate post-implementation. Concrete commands or test cases.>
```

## Field semantics

### Metadata header (the `>` blockquote at top)

- **Part of** — the parent. Always link with `#<NUM>` syntax. For the root epic itself, `Part of: — (root epic)`.
- **Sprint umbrella** — optional grouping. Used when issues belong to a Sprint X umbrella that's a child of the epic.
- **Priority** — `P0` (must-do for next release), `P1` (should-do), `P2` (nice-to-have), `P3` (backlog / optional).
- **Size** — effort estimate. `S` ≤ 1 day; `M` 1–3 days; `L` 1 week; `XL` > 1 week.
- **Status** — `Pending` (not started), `In flight` (active), `Blocked` (waiting on upstream), `Backlog` (low priority deferred), `Done` (closed).
- **Blocked by** — upstream issues that MUST close before this issue can start. ALWAYS use clickable `[#<NUM>](<URL>)` syntax.
- **Blocks** — downstream issues that wait on THIS one. Important for cold-start agents to see what's downstream. `none` if leaf.

### Body sections

- **Why this exists** — non-trivial paragraph. A cold-start reader should learn the context here, not from any other issue or external doc.
- **Action items** — concrete checkboxes. Each is a discrete, executable step. Avoid "improve X" — say "edit `file.mjs::function` to do Y".
- **Acceptance criteria** — definition of done. Prefer machine-checkable (`grep returns nothing`, `test X passes`) over subjective ("looks good").
- **Implementation pointers** — file paths, prior-art commits, sibling-issue cross-refs, external library links. ANYTHING the executing engineer needs to find without searching.
- **Test plan / Verification** — how to confirm the implementation worked. Even one bullet beats no section.

## Specifically-required cross-link patterns

- **Cross-repo references**: `<OWNER>/<REPO>#<NUM>` (e.g. `ctxr-dev/skill-code-review#5`). GitHub auto-renders these as clickable.
- **Same-repo references**: `#<NUM>` is fine; richer is `[#<NUM>](https://github.com/<OWNER>/<REPO>/issues/<NUM>)` (clickable in plain Markdown contexts too).
- **Bidirectional blocked-by**: if A says `Blocked by: B`, then B's body should say `Blocks: A`. The validator catches asymmetry.

## Why this strictness

- **Cold-start ready**: a future agent session opening any issue gets the full picture in ≤ 30 seconds.
- **Machine-validatable**: the script checks shape, not content. Discipline at write time prevents drift over months.
- **Cross-link integrity**: parent / blocker / sibling refs render as clickable in the GH UI.
- **Audit trail**: every closed issue stays as the canonical reason-for-the-change.

## What is NOT required

- Decision log inside every issue body. Decision log lives in the EPIC.
- Full design doc inline. If the design is large, the issue body cites a `docs/` markdown file or sibling issue.
- Prose state machines. If the issue is implementation-of-an-FSM-state, the body cites the YAML; the YAML is canonical.

## Closed-on-creation issues (audit-trail entries)

Sometimes you create an issue for work already shipped (e.g. for cross-link audit trail). Same schema, but:

- `Status: Done` in the metadata.
- Close the issue immediately after creation: `gh issue close <num> --reason completed --comment "Implemented in PR #N commit <sha>"`.
- Action items pre-checked.
- Add `> **Closed by:** PR #<N> commit \`<sha>\`` in the metadata block.

This pattern preserves the audit trail without polluting the open-work queue.
