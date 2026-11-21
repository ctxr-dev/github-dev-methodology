---
feature: cold_start
requires:
  features: [issue_schema]
  config: [primary_repo, project_url]
---

# Cold-start workflow

How to pick up an issue with no prior context and start work within minutes.

## The 4-step warm-up

### Step 1: Read the config

Run `gdm config get active_project` and read `.github-dev-methodology/config.json` at the repo root. Note:

- `org`, `primary_repo` and `sibling_repos`.
- `project_url`: the project board.
- `review.reviewers` and `review.required_reviewers`: who the PR watch waits for.
- `merge.authority`: who may merge.

If the file is missing, stop and run `gdm init` after asking the owner for the preset, org and repo. See [`configuration.md`](configuration.md).

### Step 2: Read the issue

```bash
gh issue view <NUM> --repo <OWNER>/<REPO> --json number,title,state,body,labels,assignees,comments
```

Check that the body has the five sections from [`issue-schema.md`](issue-schema.md): Why, Action items, Acceptance, Implementation pointers, Test plan. Confirm with:

```bash
gdm validate issues <OWNER>/<REPO> --touched <NUM>
```

If it fails, the issue is not cold-start ready. Stop and ask the owner. If another person or agent is assigned, pick a different issue.

### Step 3: Walk up to the root

```bash
gdm validate tree https://github.com/<OWNER>/<REPO>/issues/<NUM> --up
```

`--up` prints the parent chain to the root and every open blocker. Check:

- The chain reaches the root within 4 hops, with no cycle.
- Every `blockedBy` issue is closed.

If a blocker is still open, the issue is not ready. Pick another issue or stop.

### Step 4: Check the project board

Read the issue's project `Status`, Priority and Effort. The `Status` vocabulary is `Backlog`, `Ready`, `In progress`, `In review`, `Done`.

- `Ready`: proceed.
- `Backlog`: ask the owner before you start.
- `In progress` for someone else: do not start.

The project field is the only status record. If something else disagrees, trust the project field and report the difference.

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){projectItems(first:10){nodes{fieldValues(first:20){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}}}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<NUM>
```

## Then: execute the action items

Claim the issue first (assign yourself, set `Status` to `In progress`), as described in [`issue-lifecycle.md`](issue-lifecycle.md). Then for each action item checkbox:

1. Read the item fully.
2. Implement it.
3. Tick the box in the issue body (`- [ ]` to `- [x]`). Do it as you go and do not batch (see [`audit-vs-execute.md`](audit-vs-execute.md)).
4. Move to the next item.

When every box is ticked and the Acceptance section is met, open a PR per [`pr-loop.md`](pr-loop.md). The PR title cites the issue: `<type>(<scope>): <subject> (#<NUM>)`.

## When the issue is not cold-start ready

1. Do not guess. Stop and ask the owner.
2. If the owner clarifies, offer to fold the clarification into the issue body so the next session does not hit the same gap.
3. If the owner agrees, edit the body before you start work. Issues are the source of truth.

## When you find drift

- The PR is already open but `Status` is `Ready`: the board is stale. Report it.
- A `blockedBy` issue is closed but `Status` is still `Backlog`: the issue is unblocked. Ask the owner whether to move it to `Ready`.
- The plan file names an issue that does not exist: the migration was incomplete. Stop and report.

Drift is a signal that an earlier session ended unclean. Tell the owner. Do not paper over it.
