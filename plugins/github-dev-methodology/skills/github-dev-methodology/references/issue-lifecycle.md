---
feature: issue_lifecycle
requires:
  features: []
  config: [primary_repo]
---

# Issue lifecycle for single-fix work

The flow for one defect or one small feature that fits in one pull request. For several related changes, use [`plan-to-issues.md`](plan-to-issues.md).

This is Lane 1 in [`../SKILL.md`](../SKILL.md). Lane 0 changes (bot dependency PRs, typo fixes) need no issue.

## When this flow applies

- A reproducible bug with a clear scope.
- A small feature that fits in one PR.
- A focused refactor with a defined boundary.

If the work needs several PRs or workstreams, write a plan and create a sub-issue tree.

## Who owns which Status

The project `Status` field has one vocabulary: `Backlog`, `Ready`, `In progress`, `In review`, `Done`.

| Transition | Owner |
|---|---|
| `Backlog` or `Ready` to `In progress` | Agent, when it claims the issue |
| `In progress` to `In review` | Agent, when the PR is open and review-ready |
| `In review` to `Done` | Human only, by merging the PR and closing the issue |

The agent never sets `Done`. Status is never written in the issue body.

## The flow

### 1. Create the issue first

Use the template [`../assets/issue-body.md`](../assets/issue-body.md) and the rules in [`issue-schema.md`](issue-schema.md):

```bash
gh issue create --repo <OWNER>/<REPO> \
  --title "<type>(<scope>): <subject>" \
  --body-file <body.md> \
  --type <Bug|Feature|Task>
```

If `issue_schema` is on, run `gdm validate issues <OWNER>/<REPO> --touched <N>` before moving on.

### 2. Claim it

Before you create a branch:

1. Check the assignees. If another person or agent is assigned, skip the issue and pick another one.
2. Assign yourself: `gh issue edit <N> --repo <OWNER>/<REPO> --add-assignee @me`.
3. Set project `Status` to `In progress` (GraphQL `updateProjectV2ItemFieldValue`). Re-running it is safe.

### 3. Branch in a worktree

```bash
gdm worktrees add <type>/<N>-<short-slug>
```

Work in that worktree and never commit on the default branch. See [`worktrees-and-stacks.md`](worktrees-and-stacks.md). Name the branch after the issue, for example `fix/42-null-deref`.

### 4. Run the PR loop

Follow [`pr-loop.md`](pr-loop.md). The PR body ends with a closing footer:

```
Closes <OWNER>/<REPO>#<N>
```

Use the fully qualified form when the PR and the issue may live in different repos. Commit format is in [`commits.md`](commits.md).

When the PR loop exit predicate holds (PR open, reviewers green, CI green), set `Status` to `In review`. This is the agent's last Status change.

### 5. Merge

Merge follows the project merge authority, never the agent's own judgment. Run `gdm pr can-merge <PR>` first. With authority `human`, wait for the owner to merge. See [`audit-vs-execute.md`](audit-vs-execute.md).

### 6. Close the issue

Closing is human-owned. The agent may propose the comment:

```
Shipped in <merged-commit-sha> via #<PR>.
```

GitHub closes the issue by itself only when the PR merges into the default branch. These cases do not auto-close:

- The PR merged into a release branch that merges to the default branch later.
- `Closes` was added to the PR description after the merge.
- The issue lives in another repo than the PR.
- The PR was closed and the fix shipped by another commit.

After the owner confirms the merge, check the issue state. If it is still open, ask the owner to close it.

### 7. Bundling rules

- Several related fixes may share one issue. List them as checkboxes and tick them as commits land.
- Unrelated fixes get one issue and one PR each. Never bundle them: review gets tangled and a revert gets costly.
- A batch of approved issues: open them in priority order, one PR each.

## Related

- [`pr-loop.md`](pr-loop.md): the PR mechanics this flow drives.
- [`commits.md`](commits.md): Conventional Commits and the `Closes` footer.
- [`issue-schema.md`](issue-schema.md): required body sections and native metadata.
- [`plan-to-issues.md`](plan-to-issues.md): the path when one issue is not enough.
- [`audit-vs-execute.md`](audit-vs-execute.md): why merge and close need the owner.
