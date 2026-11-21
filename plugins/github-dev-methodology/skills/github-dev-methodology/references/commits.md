---
feature: conventional_commits
requires:
  features: []
  config: []
---

# Conventional commits + reviewer-request mechanics

## Conventional Commits 1.0 (MUST)

Every commit MUST follow `<type>(<scope>): <subject>`. Types:

- `feat(<scope>): <subject>` - new capability.
- `fix(<scope>): <subject>` - bug fix.
- `docs(<scope>): <subject>` - documentation only.
- `chore(<scope>): <subject>` - tooling, infra, dep bumps.
- `refactor(<scope>): <subject>` - internal restructure, no behaviour change.
- `test(<scope>): <subject>` - test additions/changes only.
- `style(<scope>): <subject>` - whitespace, formatting; no semantic change.
- `perf(<scope>): <subject>` - performance optimization.

Scope: a brief subsystem identifier (`scope: skill-name`, `scope: tracker-sync`, `scope: pr-iteration`, etc.). Optional but recommended.

Subject: imperative ("add X" not "added X"). ≤ 72 chars. Start lowercase except proper nouns.

Body (optional): explains WHY. Wrap at 72 chars. Reference the issue it closes via a footer line: `Closes <OWNER>/<REPO>#<NUM>`.

### Multi-line example

```
feat(pr-iteration): autonomous mode exit on reviewer + CI predicate

Implements the canonical loop exit per pr-loop.md: terminates iff every
required reviewer has approved-no-comments AND CI status is success. Falls
back to interactive mode when --interactive flag is set.

Closes ctxr-dev/agent-staff-engineer#52
```

## Reviewer requests

> **Skip the Copilot parts of this section if `copilot_review` is off in the active project.** The methodology then requests only the individual logins in `review.reviewers` with `gh pr edit --add-reviewer <login>`. A team may be requested for review, but the watch tracks individual review authors, so list member logins in `review.reviewers`. An empty `reviewers` list means CI-only (see [`pr-loop.md`](pr-loop.md)).

The PR loop ([`pr-loop.md`](pr-loop.md)) requires a review request after every push. One command does it:

```bash
gdm pr request-reviews <owner/repo#N>
```

It requests the configured reviewer set, then reads `reviewRequests` back. If a login is missing from the result it prints `request-ignored: <login>` on stderr and exits 1. Do not assume a request worked because the call returned.

### Why Copilot needs GraphQL

REST `RequestReviewers` silently does nothing for bot accounts:

- `gh pr edit <num> --add-reviewer copilot-pull-request-reviewer` is ignored.
- `gh pr create --reviewer copilot-pull-request-reviewer` is ignored.
- A `@copilot-pull-request-reviewer` mention in a comment does not create a request.
- GraphQL `requestReviews(input: { userIds: [<bot-id>] })` returns `NOT_FOUND`, because `userIds` is for `User` nodes only.
- GraphQL `requestReviews(input: { botIds: [<bot-id>], union: true })` works.

`gdm pr request-reviews` uses the working form. It takes the bot id from `cache.copilot_bot_id` in the repo config, or discovers it through `suggestedActors` and writes it back to the config. `union: true` keeps existing requests. An empty `reviewRequests` list right after the call is not a failure: Copilot has taken the request and started its review.

Then hand off to `gdm pr watch`, which confirms the reviewer has reviewed HEAD. No separate poll after the request is needed.

### When Copilot is not installed

Copilot is installed on a repo only if a recent PR shows a review by the bot `copilot-pull-request-reviewer`. If it is not installed:

1. Read `review.reviewers` from the repo config. If it is non-empty, use it.
2. If it is empty and you expect human review, ask the owner which individual logins to use (for a team, the member logins you expect to review, not the team slug). Write the answer to `review.reviewers` and `review.required_reviewers`. Required approvers must be human user logins.
3. If the owner wants CI-only, leave `reviewers` as `[]`.
4. Humans are requested with plain REST: `gh pr edit <num> --repo <OWNER>/<REPO> --add-reviewer <login>`.

## Resolving review threads after fixing

After a commit that addresses a reviewer's comment, resolve the thread in the same turn:

```bash
gdm pr threads <owner/repo#N> --json
gdm pr threads <owner/repo#N> --resolve <threadId> [--resolve <threadId>...]
```

`gdm pr threads` lists unresolved, non-outdated threads and follows every page. `--resolve` calls the GraphQL `resolveReviewThread` mutation for each id. Use `--author <login>` to look at one reviewer's threads.

Pagination matters: a long-running PR can pass 50 threads, and a query for only the first page reports "0 unresolved" while the UI still shows open threads.

Do not resolve threads you did not address. They mean you missed the point or the reviewer wants more discussion.

Resolving does not make a reviewer re-review. It only keeps the unresolved set equal to your outstanding work, which is what the exit predicate reads.

### Why GraphQL only

REST review endpoints (`repos/.../pulls/N/comments`) return review comments, not review threads. Only the GraphQL `reviewThreads` surface has the resolve mutation. There is no REST shortcut.

Beyond threads, prefer GraphQL for every PR mutation and state query: `requestReviews`, `resolveReviewThread`, `reviewRequests`, `reviewThreads`, `reviews`, and bot node ids. REST has shown inconsistent state propagation in field reports: reviewers appear added but notifications do not fire, or state shows in the API but not in the UI. Use REST only when GraphQL has no equivalent.
