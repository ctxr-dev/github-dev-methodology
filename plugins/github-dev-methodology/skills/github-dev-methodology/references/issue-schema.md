---
feature: issue_schema
requires:
  features: []
  config: [org, primary_repo]
---

# Issue schema

Every issue created through this methodology has two parts: native GitHub metadata and a body with fixed sections. `gdm validate issues` checks the body. Metadata lives in GitHub fields, never in the body.

## Metadata is native data

| Fact | Where it lives |
|---|---|
| Parent | Sub-issue link (`gh issue create --parent`, or `gh issue edit --parent`). |
| Blocked by / Blocks | Issue dependencies (`blockedBy`). Both directions come from the one link. |
| Kind of work | Native Issue Type (`Epic`, `Feature`, `Bug`, `Task`). Use the `type:*` labels only when the org has no Issue Types (see [`label-taxonomy.md`](label-taxonomy.md)). |
| Priority, Effort | Issue fields when the org has them. Otherwise project fields. |
| Status | Project field `Status`: `Backlog`, `Ready`, `In progress`, `In review`, `Done`. Never in the body. |

Do not write parent, blocker, priority or status lines in the body. They go stale, and GitHub already shows the native data.

Check which issue fields the org offers:

```bash
gh api graphql -f query='{organization(login:"<OWNER>"){issueFields(first:20){nodes{__typename}}}}'
```

If the org has none, write Priority and Effort to project fields. `gdm plan sync` does this and logs `issue fields unavailable`.

## Regular issue body

The template is [`../assets/issue-body.md`](../assets/issue-body.md). These five sections are required, in this order:

```markdown
## Why

## Action items

## Acceptance

## Implementation pointers

## Test plan
```

- **Why**: the problem and the outcome. A cold reader should learn the context here and not from another issue.
- **Action items**: concrete checkboxes. Each is one executable step. Write "edit `file.mjs::fn` to do Y", not "improve X".
- **Acceptance**: the definition of done. Prefer checks a command can answer ("`npm test` passes", "`grep` returns nothing") over opinions.
- **Implementation pointers**: file paths, prior commits, sibling issues, library links. Anything the implementer would otherwise search for.
- **Test plan**: how to confirm the change works. One bullet is enough.

## Epic body

An epic is an issue with native type `Epic` (or label `type:epic` when the org has no Issue Types). The template is [`../assets/epic-body.md`](../assets/epic-body.md). Required sections:

```markdown
## Mission

## Children

## Decision log
```

- **Mission**: one paragraph on what the epic delivers.
- **Children**: the sub-issues, one line each. The sub-issue links are the source of truth; this list is for readers.
- **Decision log**: dated decisions and reasons. Decisions live here, not in every child.

## What `gdm validate issues` enforces

- Headings are read outside code fences. A heading inside a fenced block does not count.
- A section with no content counts as missing.
- Each failure prints the missing headings and the template path.

```bash
gdm validate issues <owner/repo> --touched 12,13,14
```

`--touched` limits the check to the issues you created or edited. Without it the whole repo is checked (`--state open|all`).

## Cross-links

- Same repo: `#<NUM>`.
- Other repo: `<OWNER>/<REPO>#<NUM>`. GitHub renders both as links.
- In a plan manifest, use placeholders such as `{{KEY}}`. `gdm plan sync` replaces them with real numbers (see [`plan-to-issues.md`](plan-to-issues.md)).

## What is not required

- A decision log in every issue. It lives in the epic.
- A full design document inline. Link a `docs/` file or a sibling issue.
- Prose state machines. If the issue implements an FSM state, link the YAML; the YAML is canonical.

## Closed-on-creation issues

Sometimes an issue records work that already shipped. Use the same body, with every action item checked. Create it, then close it:

```bash
gh issue close <NUM> --repo <OWNER>/<REPO> --reason completed --comment "Implemented in PR #<N>, commit <sha>."
```

Set project Status to `Done` for it. Closing is a human action when the issue tracks live work; for an audit-trail entry the owner has already approved, the agent may close it.

## Related

- [`issue-lifecycle.md`](issue-lifecycle.md): the single-issue flow.
- [`plan-to-issues.md`](plan-to-issues.md): many issues from a plan.
- [`cold-start.md`](cold-start.md): picking up an issue with no context.
- [`configuration.md`](configuration.md): project settings.
