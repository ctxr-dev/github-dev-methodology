---
feature: cold_start
requires:
  features: [issue_schema]
  config: [primary_repo, project_url]
---

# Cold-start workflow

How to pick up an issue with zero prior context and start executing within minutes.

## The 4-step warm-up

### Step 1 — Read the methodology config

Open `.agents/ctxr-dev/github-dev-methodology.config.local.md` (the per-project config). Capture:

- `<PROJECT_URL>` — the project board.
- `<OWNER>` — the GitHub org.
- `<REPO>` (and any sibling repos involved).
- `reviewers`: the set watched on every PR (Copilot / individual human logins; a team is requested for review but tracked via its member logins, since the watch matches individual review authors); plus `required_reviewers` (the must-approve humans). Legacy `default_reviewer` is honored as a one-element fallback.
- Any per-project overrides for cadence / max-duration / poll interval (`pr_loop_poll_seconds` default 60, `pr_loop_max_hours`, `pr_loop_wait_for`).

If the file is missing, halt and ask the user to populate it from `templates/config.local.md` before proceeding.

### Step 2 — Read the issue you're about to execute

```bash
gh issue view <NUM> --repo <OWNER>/<REPO> --json number,title,state,body,labels,comments
```

Verify the body has the canonical schema (Metadata table + Why + Action items + Acceptance + Implementation pointers + Test plan). If it doesn't:

- The issue isn't cold-start ready. Halt and ask the user.
- OR run `node scripts/validate-issue-schema.mjs <OWNER>/<REPO>` to confirm the issue is malformed system-wide.

### Step 3 — Walk the parent chain to the root

```bash
node scripts/validate-tree.mjs <OWNER>/<REPO>#<NUM>
```

Verify:
- The issue's `Blocked by:` upstream issues are CLOSED.
- The chain reaches the project root within ≤ 4 hops.
- No cycles.

If any blocker is still OPEN, the issue isn't ready to start. Pick a different issue or halt.

### Step 4 — Confirm the project board state

Pull the issue's project-board fields (Status / Priority / Size). If `Status: Ready` and the metadata header agrees, proceed. If the project shows `Backlog` or `Blocked` while the body shows `Pending`, the project board is the source of truth — defer to it.

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){projectItems(first:10){nodes{fieldValues(first:10){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}}}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<NUM>
```

## Then: execute the action items

Iterate through the issue's Action items checkboxes. For each:

1. Read the checkbox description fully.
2. Implement.
3. Tick the box: edit the issue body to flip `- [ ]` → `- [x]`. Commit-or-update-on-the-fly per [`audit-vs-execute.md`](audit-vs-execute.md) (don't batch).
4. Move to the next checkbox.

When all checkboxes are checked + Acceptance criteria are visibly satisfied: open a PR per [`pr-loop.md`](pr-loop.md). The PR title cites the issue: `<type>(<scope>): <subject> (#<NUM>)`.

## When the issue isn't cold-start ready

If after Step 2 you can't extract enough to start:

1. **Don't guess** — halt and ask the user for clarification.
2. If the user clarifies, ASK if they want the clarification folded into the issue body (so the next session doesn't hit the same gap).
3. If they say yes, edit the body BEFORE starting work. The methodology is "issues are source of truth"; updating the issue keeps that promise.

## When you find drift

Common drift patterns:

- Issue says `Pending` but PR is already open → Status field on board is stale; update via `gh project ... updateProjectV2ItemFieldValue` mutation.
- Issue says `Blocked by: #X` but #X is closed → unblocked; Status should flip to `Ready`.
- Plan file mentions an issue number that doesn't exist → migration was incomplete; halt and report.

Drift is not your fault — it's a signal the previous session didn't complete cleanly. Surface it to the user; don't paper over.
