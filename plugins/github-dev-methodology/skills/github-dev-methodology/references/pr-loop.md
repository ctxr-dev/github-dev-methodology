---
feature: pr_loop
requires:
  features: []
  config: [primary_repo]
---

# PR review loop

The canonical pattern for filing, iterating on, and merging PRs in a repo that uses this methodology. `gdm` means `node <skill-dir>/scripts/gdm.mjs`; see [`SKILL.md`](../SKILL.md).

For the issue side of the flow (issue, branch, PR, close), see [`issue-lifecycle.md`](issue-lifecycle.md). This file covers PR mechanics. Settings named here (`review.reviewers`, `review.poll_seconds` and so on) are documented in [`configuration.md`](configuration.md).

## Exit predicate

The loop watches a set of reviewers (Copilot and named humans), not one reviewer. A team can be requested for review, but the watch matches individual review-author logins, so a team is tracked through its member logins, never a bare team slug.

A PR is ready iff all three hold:

1. **Every configured reviewer has re-reviewed the current HEAD and is green.** For each reviewer, take their latest review, excluding `DISMISSED` and `PENDING` reviews. Then:
   - `pending`: they have no such review on the HEAD commit yet.
   - `needs-work`: they reviewed HEAD, and either their latest state is `CHANGES_REQUESTED`, or at least one review thread with `isResolved == false` and `isOutdated == false` was first authored by them.
   - `green`: they reviewed HEAD and are not `needs-work`.

   The signal is "reviewer re-reviewed HEAD, and has no unresolved, non-outdated thread". It is not `review.comments.totalCount`. That count omits replies and misses thread-based findings (Copilot is always `COMMENTED` and can post a summary with zero inline comments).
2. **Every required approver is `APPROVED` on HEAD.** The required set is `review.required_reviewers` (humans only). The watch does not expand CODEOWNERS. If the project relies on CODEOWNERS, resolve the owners of the changed paths yourself and add them to `review.required_reviewers`. A bot `APPROVED` is green, but it never counts as a required approval.
3. **CI is success for the head SHA.** A repo with no checks has a null status rollup, and null means "no CI gate".

Otherwise, keep iterating.

Thread resolution is mandatory bookkeeping, not the exit signal. Resolving a thread does not make a reviewer re-review. It keeps the set of unresolved, non-outdated, reviewer-authored threads equal to your outstanding work, which is what predicate (1) reads. Resolve every thread you fixed in the same push. A thread left open keeps its author `needs-work` forever.

### Things that look like exit but are NOT exit

None of these, alone or together, satisfies the predicate:

- CI green: necessary, not sufficient. Predicate (1) is independent of CI.
- `mergeable: MERGEABLE` or `mergeStateStatus: CLEAN`: this only means no conflicts and required checks pass. It says nothing about review state.
- All threads resolved, but a configured reviewer has not re-reviewed HEAD: resolve, then wait for the re-review. Declaring exit at resolution time is wrong.
- A reviewer is green, but on a stale commit: the latest non-dismissed review must be on the current HEAD SHA.
- No new comments since the last push: silence is not approval. A required human must be `APPROVED` on HEAD. A non-required reviewer must be on HEAD with no unresolved non-outdated thread, after the latest push.
- You believe the remaining comments are out of scope: say so in a PR comment. Out-of-scope feedback is pushed back on (resolve the thread with a rationale), turned into a follow-up issue, or deferred. It is never left open, and the predicate does not bend.

Until predicates (1), (2) and (3) all hold, the PR is not ready for merge, even if the diff feels finished and the human reviewer is idle. Report the state honestly ("CI green, mergeable, but reviewer X is still on a stale commit and reviewer Y left an unresolved thread on HEAD") and continue the loop, or escalate under "Halt conditions".

## Reviewer set

The set comes from `review.reviewers` in the repo config. Each entry is an individual login. `copilot` is an alias for `copilot-pull-request-reviewer`. `review.required_reviewers` is the subset whose `APPROVED` gates the exit predicate.

How the set is chosen:

1. `review.reviewers` is non-empty: use it as is. Every entry is requested on every PR.
2. `review.reviewers` is empty: the loop is CI-only (see below).
3. The owner has not decided yet: ask once, with options (Copilot, collaborators, CODEOWNERS, teams; which humans must approve). Write the answer to `review.reviewers` and `review.required_reviewers` in `.github-dev-methodology/config.json`. Do not ask again in later sessions.

Read the current values with `gdm config get review.reviewers`.

### CI-only mode

`review.reviewers: []` means no reviewer is watched. Predicate (1) and (2) hold trivially, and the PR is ready when CI is success. Use this for repos where no human or bot reviews PRs.

### Bot reviewers

A bot is a reviewer whose login ends in `[bot]`, or the Copilot alias. A bot can fail to review, so it must not block forever:

- The bot has no review on HEAD, and `review.bot_review_timeout_minutes` (default 15) have passed since the HEAD push: the state is `skipped-timeout`. It no longer blocks.
- The bot is not in the PR's review requests and has no review on HEAD: the state is `skipped-not-requested`. It no longer blocks.

Both skip states are reported in the watch output. A skip is not a failure; it is how Copilot outages and unrequested bots stop stalling the loop.

> **Skip this section if `copilot_review` is off.** With Copilot off, request humans through plain `gh pr edit --add-reviewer <login>` (see [`commits.md`](commits.md)). `gdm pr request-reviews` still works for human reviewers.

### Requesting reviews (`copilot_review`)

Run `gdm pr request-reviews <pr>`. It requests the whole configured set. Copilot is requested through GraphQL `botIds` because the REST endpoint silently ignores bots. The Copilot bot id comes from `cache.copilot_bot_id`. If it is null, the command discovers it from `suggestedActors` and writes it back to the repo config. After requesting, the command reads the review requests back. If a configured login is missing, it prints `request-ignored: <login>` on stderr and exits 1. Treat that as a failed request: fix the cause (access, bot not installed on the repo) before you wait.

## Loop step by step

1. Preflight: `gdm doctor`. Create the branch worktree with `gdm worktrees add <type>/<slug>` and work inside it (see [`worktrees-and-stacks.md`](worktrees-and-stacks.md)).
2. Author the change and run the project's tests and lint. They must pass before you commit.
3. Commit using [`commits.md`](commits.md).
4. Push and open the PR. In Lane 1, the body contains `Closes owner/repo#N`.
   ```sh
   git push -u origin "$(git branch --show-current)"
   gh pr create --repo <owner>/<repo> --title "<title>" --body-file <file>
   ```
5. Request reviews: `gdm pr request-reviews <pr>`.
6. Wait: `gdm pr watch <owner>/<repo>#<N>`, in the mode set by `review.wait_mode` (see "Waiting").
7. When the watch reports a reviewer `needs-work`, address the threads (see "Addressing review comments"), push, resolve what you fixed, re-request reviews, and watch again.
8. When the watch exits 0, run the optional conformance review (see "Halt conditions"), then apply "Merge authority".

## Waiting

`gdm pr watch <owner/repo#N>... [--bounded <sec>] [--max-wait <sec>] [--json]` polls every `review.poll_seconds` (default 60). It prints one line per state change (JSON lines with `--json`). It watches several PRs at once when you pass several.

| Exit | Meaning |
|---|---|
| 0 | Every watched PR is ready. |
| 1 | Three consecutive `gh` errors. |
| 2 | `--max-wait` elapsed. The default is `review.max_hours * 3600` seconds (24 hours). |
| 3 | `--bounded` ended the wait and the PR is not ready yet. |

Pick the mode from `review.wait_mode`:

- **`foreground`** (default): keep `gdm pr watch` running in the foreground until it exits 0, 1 or 2. When the harness shell has a command timeout shorter than the wait, run `gdm pr watch ... --bounded 540` and run it again each time it exits 3. Control does not return to the owner between runs.
- **`wakeup`**: run `gdm pr watch ... --bounded <sec>`. On exit 3, schedule a harness self-wake after `review.poll_seconds` and end the turn by stating the wake time. On wake, run the watch again. Use this only when the harness has a self-wake primitive.

If the MCP server `mcp-github` is available, `gh.pr_review_watch` and `gh.pr_request_reviews` do the same work. `gh.pr_review_watch` blocks for a bounded window, so set `maxWaitSeconds` to 25 or less, keep the returned `fingerprint`, and pass it back as `sinceFingerprint` on the next call so it returns only on the next change. `gdm` is the primary interface; the MCP tools are optional.

### Things that look like a valid pause but are NOT

- "I'll check back in a minute" and then returning control to the owner. In `foreground` mode the watch stays running. In `wakeup` mode you may return control only after scheduling the wake and stating its time.
- Scheduling a wake-up without a stated wake time, or in `foreground` mode.
- Marking the PR or task done while waiting for review.
- Asking the owner to confirm CI status, reviewer state or thread resolution. Read it yourself.
- Treating one no-change cycle as a halt condition. Silence is normal. Watch again.

## Addressing review comments

The set of unresolved, non-outdated threads whose first comment author is a configured reviewer is your outstanding work. Keep that set honest. GitHub does not resolve threads when you push: they become `isOutdated: true` but stay `isResolved: false`. A thread you pushed back on or deferred must be resolved with a rationale or moved to a follow-up issue, never left open.

When the watch reports `needs-work`:

1. **List the threads:** `gdm pr threads <pr> --author <login>`. It follows pagination until every thread is read, so a long-running PR does not hide threads. Add `--json` for structured output.
2. **Read** each thread and the code it cites. Read the actual file, not just the summary.
3. **Decide** per thread: fix it, push back with reasoning, or ask the owner.
4. **Fix:** edit, run the tests, commit (`fix(review): <what>`), push.
5. **Resolve every thread you fixed, in the same push:** `gdm pr threads <pr> --resolve <threadId>...`. Thread ids are in the `--json` output.
   - A thread you pushed back on or deferred: post a rationale comment, then resolve it. Or open a follow-up issue and resolve with a link.
   - A thread you did not address and did not consciously decide on stays open. It is still live discussion.
6. **Re-request the set:** `gdm pr request-reviews <pr>`, so each reviewer's latest review lands on the new HEAD. Copilot often picks up a push by itself, but an explicit request removes doubt for humans and is what predicate (1) needs. Then watch again.

## Merge authority

The repo config key `merge.authority` says who may merge. New installs use `human`.

| Authority | Who merges |
|---|---|
| `human` | The owner only. The agent never merges. |
| `scoped` | The agent may merge only inside the listed `merge.scopes`. |
| `autonomous` | The agent may merge any ready PR. |

Scopes for `scoped`: `dependabot-green` (a ready PR authored by `dependabot[bot]` or `renovate[bot]`) and `session-instruction` (the owner said so in this session).

Before any `gh pr merge`, before enabling auto-merge, before adding a PR to a merge queue, and before `gh stack merge`, run `gdm pr can-merge <pr>`. It does not merge anything. It only decides.

| Exit | Decision | What you do |
|---|---|---|
| 0 | allow | You may merge. |
| 3 | deny: the PR is not ready | Keep iterating the loop. |
| 4 | deny, or ask: needs a human | Stop. Report the reason and let the owner merge or grant the scope. |

The `scoped` authority with the `session-instruction` scope returns exit 4 with the reason `needs explicit owner instruction in this session`. After the owner gives that instruction in the session, you may merge.

Hooks enforce this. On Claude Code and OMP a merge command is blocked, or the owner is asked, when the authority forbids it. On Codex the hook can only deny, and it fails open if the hook breaks, so on Codex the protection is best effort and you must still run `gdm pr can-merge` yourself. See [`installation.md`](installation.md).

## Halt conditions

Stop the loop and report to the owner when:

- The exit predicate holds. Run `gdm pr can-merge <pr>` and follow its decision. When `subagent_review` is on, this is the merge-prep point for the optional conformance-review gate: offer a parallel-subagent review of the built work against the plan before you call the PR ready (see [`agents-orchestration.md`](agents-orchestration.md), "Optional review gates").
- `gdm pr watch` exits 2 (24 hours by default): report "stalled, no progress, please advise".
- `gdm pr watch` exits 1: GitHub or `gh` is failing. Report the error text.
- The owner says stop or changes course.
- Branch protection blocks the merge although the predicate holds. The rule set is stricter than the methodology assumed. Escalate.

One cycle without change is never a halt condition.

## Guardrails

- Never force-push without explicit owner authorization.
- Never skip pre-commit or pre-push hooks (`--no-verify`).
- Never merge without `gdm pr can-merge` exit 0. See [`audit-vs-execute.md`](audit-vs-execute.md). Words like "merge" or "ship it" from the owner count as the `session-instruction` scope only when `merge.scopes` lists it.
- Dependabot alerts and CI failures block the PR. Fix them before you call the predicate true.
