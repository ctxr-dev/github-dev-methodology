---
feature: pr_loop
requires:
  features: []
  config: [primary_repo]
---

# PR review loop

The canonical pattern for filing, iterating, and merging PRs in any project that imports this methodology.

For the broader issue → branch → PR → close flow that wraps this loop, see [`issue-lifecycle.md`](issue-lifecycle.md). This file covers PR mechanics; the lifecycle file covers the issue side.

## Exit predicate

The loop watches a SET of reviewers (Copilot + named humans; see "Reviewer set" below), not a single reviewer. (A team can be REQUESTED for review, but the watch matches individual review-author logins, so a team is tracked via its member logins, never a bare team slug.) It terminates iff ALL three hold:

1. **Every CONFIGURED reviewer has re-reviewed the current HEAD and is green.** Per reviewer, take their latest review via the `latestReviews` connection, EXCLUDING `DISMISSED` and `PENDING` states, then:
   - `pending`: no such review whose `commit.oid == <HEAD SHA>` (they have not reached HEAD yet).
   - `needs-work`: on HEAD AND (latest state `CHANGES_REQUESTED` OR there is >=1 review thread with `isResolved == false && isOutdated == false` whose first comment author is this reviewer).
   - `green`: on HEAD AND not needs-work.

   The exit signal is **reviewer-re-reviewed-HEAD plus no unresolved, non-outdated thread authored by that reviewer**, NOT `review.comments.totalCount`. That field undercounts (it omits replies) and misses Copilot's thread-based findings (Copilot is always `COMMENTED` and can carry a non-empty summary with zero inline comments), so it is the wrong signal. Use the per-reviewer unresolved-non-outdated-thread count instead. Check via:
   ```graphql
   latestReviews(first:100) { nodes { author { login } state commit { oid } } }
   reviewThreads(first:100) { nodes { isResolved isOutdated comments(first:1) { nodes { author { login } } } } }
   ```
2. **Every required-approver is `APPROVED`.** The required set = configured `required_reviewers` (humans only; bots have no `APPROVED` state). The watcher does NOT auto-expand CODEOWNERS: if a project relies on CODEOWNERS, the agent resolves the owners for the changed paths itself and includes them in the required set it passes (config `required_reviewers`, or the script's `--required`). A green human in the required set must also be `APPROVED`, so an "all-green / zero-approvals" state does not slip past branch protection.
3. **CI status: success** for the head SHA. `statusCheckRollup` is null when the repo has no checks; treat null as "no CI gate" unless the project sets `require-ci`, in which case null fails with a clear reason.

Otherwise: keep iterating.

Note on thread resolution: **resolving a thread is mandatory bookkeeping, not the exit signal itself.** `resolveReviewThread` does not make a reviewer re-review, so resolving alone never satisfies predicate (1); the reviewer must come back to HEAD. What resolution buys you is honesty: it keeps the set of unresolved, non-outdated, reviewer-authored threads equal to your outstanding work, which is exactly the signal predicate (1) reads. Resolve every thread you fixed in the SAME push (see "Addressing review comments"); a thread left open keeps that reviewer `needs-work` forever.

### Things that look like exit but are NOT exit

These are common false-positives. None of them, alone or in any combination, satisfies the predicate above:

- ❌ **CI green**: necessary, not sufficient. Predicate (1) is independent of CI.
- ❌ **`mergeable: MERGEABLE` / `mergeStateStatus: CLEAN`**: only means there are no merge conflicts and required checks pass. It says nothing about review state.
- ❌ **All review threads `isResolved: true`, but a configured reviewer has not re-reviewed HEAD**: resolution is mandatory bookkeeping (see above), but it is not exit on its own. Predicate (1) requires each configured reviewer to re-review the current HEAD. Resolving threads then waiting for the re-review is the correct order; declaring exit at resolution-time is not.
- ❌ **A reviewer is green, but on a STALE commit**: predicate (1) requires each configured reviewer's latest non-dismissed review to be on the current HEAD SHA. A stale green review is not exit.
- ❌ **No new comments since the last push**: silence is not approval. A required human must be `APPROVED` on HEAD; a non-required reviewer (Copilot) must be on HEAD with no unresolved non-outdated thread by them AND have actually re-reviewed the latest push.
- ❌ **You believe the remaining comments are out of scope**: that is a conversation to have with the user via PR comment, not a reason to declare exit. Out-of-scope feedback is either pushed back on (resolve the thread WITH a rationale comment so it stops counting, or convert it to a follow-up issue) or deferred, but it is never left dangling and the predicate does not bend.

Until predicate (1) AND (2) AND (3) all hold, the PR is **NOT ready for merge**, even if the diff feels finished, even if the human reviewer is idle. Report current state honestly ("CI green, mergeable, but reviewer X is still on a stale commit and reviewer Y left an unresolved thread on HEAD") and continue the loop, or escalate per the halt conditions below.

## Polling cadence

- **Default cadence is 60 seconds**, configurable via `pr_loop_poll_seconds` in the per-project config.
- **Maximum 24 hours** without a state change before halt-and-ask the user (override with `pr_loop_max_hours`). Idle reviewer time is normal; don't give up early. A configured reviewer that never re-reviews keeps the loop not-done and trips the 24h halt rather than auto-completing.
- "No new comments this cycle" is NOT a reason to stop or to return control to the user; keep watching.
- **Polling is foreground and blocking.** The agent MUST keep the loop in the foreground for the entire run; control never returns to the user until the exit predicate holds, 24h elapses, or the user interrupts. There are two equivalent foreground mechanisms:
  1. **Structured (preferred when the MCP server is present): `gh_pr_review_watch`.** Call it with the watched PR set + the configured reviewer set; it blocks for a bounded window (about 25s, kept under the client tool-call timeout), then returns on the first state change, on `ready`, or on its own timeout, along with a `fingerprint`. Immediately re-invoke it, passing the returned `fingerprint` back as `sinceFingerprint` so it only returns on the NEXT transition (this is what stops a hot-loop). Keep re-invoking in the foreground until `ready` or halt; never hand control back to the user between blocks.
  2. **No-MCP fallback: the gh-CLI script as a single foreground long-poll.** Run `node scripts/pr-review-watch.mjs --pr <owner/name#N> [--pr ...] --reviewer <login> [--reviewer ...] [--required <login> ...] --interval <pr_loop_poll_seconds>`. It is ONE long-running foreground process that polls internally every `--interval` seconds, holding last-seen state in memory (so it needs no fingerprint and cannot hot-loop), and blocks until every watched PR is ready (exit 0), `--max-wait` elapses (exit 2), or it is interrupted. It computes the SAME predicate as the tool.

  Both are foreground; neither schedules a wake-up, forks to the background, or returns control to the user mid-watch. (Turn-efficiency note: the long-poll script can block a full `--interval` per cycle with no agent turns, which suits long quiet waits; the MCP tool returns within its bounded window and is re-invoked, which suits structured, multiplexed output. Power users can raise the client tool-call timeout to lengthen the tool's block.)

### Things that look like a valid pause but are NOT

These are common false exits. None of them is permitted - every one of them leaves the user nudging the agent to keep going, which defeats the loop:

- ❌ **"I'll check back in a minute."** Returning control to the user between cycles. Not allowed; the loop must block in-process (re-invoke `gh_pr_review_watch`, or stay inside the long-poll script).
- ❌ **Scheduling a wake-up / callback / cron and returning.** The harness's async wake-up primitives are NOT the polling mechanism. Use a foreground blocking watch (the tool or the long-poll script).
- ❌ **Marking the PR or task as "done" while waiting for review.** The loop is not done until the exit predicate (or 24h, or user interrupt) fires.
- ❌ **Asking the user to confirm CI status, reviewer state, or thread resolution.** The agent reads that itself each cycle.
- ❌ **Treating a single no-change cycle as a halt condition.** Silence is normal; keep going.

If a single cycle reports no progress, the agent re-arms the watch (re-invoke the tool with the last `fingerprint`, or remain in the long-poll). It does NOT report back to the user and wait for a prompt.

## Reviewer set (read from config; discovery happens once at bootstrap)

The loop triggers reviews for, and watches, a SET of reviewers persisted in the per-project config as `reviewers`. The watch matches individual review-author logins (`copilot` / `<github-login>`), so list individual logins there: a team may be requested for review, but it is tracked via the member logins who actually review (a bare `<team-slug>` would stay pending forever). The subset whose `APPROVED` gates the exit predicate is `required_reviewers` (humans only).

Order of precedence when assembling the set for this run:

1. **Persisted `reviewers` set in `.agents/ctxr-dev/github-dev-methodology.config.local.md` is non-empty?** Use it as-is (each entry is requested on every PR; `copilot` expands to `copilot-pull-request-reviewer`).
2. **Empty, but legacy `default_reviewer` is set?** Honor it as a one-element set (back-compat fallback).
3. **Neither is set?** Do a just-in-time ask for this PR (which reviewers to request, which humans must approve), then persist the answer so the next session does not re-ask.

The ONE-TIME candidate discovery and multi-select (enumerate Copilot + collaborators + CODEOWNERS + teams, ask the user, persist `reviewers` + `required_reviewers` + `copilot_bot_id`) runs at config bootstrap, not here. See [`local-config.md`](local-config.md)'s "How the agent reads it" and the first-run ask in [`index.md`](index.md). This section just reads the result.

> **Skip the Copilot expansion if `copilot_review` is off in the active project.** With Copilot off, the set is humans/teams only, requested via plain `gh pr edit --add-reviewer <login>` (see [`commits.md`](commits.md)).

## Loop step-by-step

```bash
# 0. Confirm auth + branch
gh auth status
git checkout -b <type>/<slug>          # e.g. fix/null-deref-in-x

# 1. Author + test
# ... edits ...
npm test && npm run lint               # must pass before commit

# 2. Conventional commit (see commits.md for full spec)
git commit -m "<type>(<scope>): <subject>

<body explaining why>"

# 3. Push + open PR
git push -u origin "$(git branch --show-current)"
gh pr create \
  --repo <OWNER>/<REPO> \
  --title "..." \
  --body "$(cat <<'EOF'
## Summary
...

## Test plan
- [ ] ...
EOF
)"

# 4. Trigger review for the WHOLE configured set. PREFER the gh_pr_request_reviews
#    MCP tool: it resolves logins to node ids (including the Copilot bot) and accepts
#    user_logins / team_slugs / bot_logins arrays in ONE call. No-MCP gh-CLI fallback
#    below: gh cannot pass a multi-value GraphQL list, so request each reviewer in a
#    SEPARATE union:true call (union ADDS without removing prior requests; do NOT
#    chain these mutations with && -- one bad id would abort the rest).
PR_NUM=<number>
PR_ID=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=$PR_NUM --jq '.data.repository.pullRequest.id')
COPILOT_ID=<BOT_kgDO... cached as copilot_bot_id, or discovered per commits.md>
# Copilot via botIds (REST silently no-ops on bots, so GraphQL is REQUIRED):
gh api graphql -f query='mutation($pid:ID!,$ids:[ID!]){requestReviews(input:{pullRequestId:$pid,botIds:$ids,union:true}){pullRequest{reviewRequests(first:1){totalCount}}}}' -f pid="$PR_ID" -f ids="$COPILOT_ID"
# Each human: resolve login -> User node id, then request via userIds (repeat per login):
HUMAN_ID=$(gh api graphql -f query='query($l:String!){user(login:$l){id}}' -f l=<human-login> --jq '.data.user.id')
gh api graphql -f query='mutation($pid:ID!,$ids:[ID!]){requestReviews(input:{pullRequestId:$pid,userIds:$ids,union:true}){pullRequest{reviewRequests(first:1){totalCount}}}}' -f pid="$PR_ID" -f ids="$HUMAN_ID"

# 5. Watch the set in the FOREGROUND until the exit predicate holds (default cadence 60s).
#    DO NOT replace this with a wake-up tool or callback that returns control to the user.
#    Either re-invoke the gh_pr_review_watch MCP tool in a loop (passing back its fingerprint),
#    or run the long-poll script below as a single blocking foreground process:
node scripts/pr-review-watch.mjs \
  --pr <OWNER>/<REPO>#$PR_NUM \
  --reviewer copilot --reviewer <human-login> \
  --required <human-login> \
  --interval ${PR_LOOP_POLL_SECONDS:-60}
# Exit 0 = every configured reviewer green on HEAD + required approvals + CI (predicate met).
# Exit 2 = --max-wait elapsed. On each non-ready cycle: address comments, push the fix,
# resolve the threads you fixed in the SAME push (see below), re-request the set, stay in the watch.
```

## Addressing review comments (the mandatory loop)

**Invariant:** the set of unresolved, non-outdated review threads whose first comment author is a configured reviewer IS your outstanding actionable work. Keep that set honest and each cycle processes only NEW asks. Two caveats make it honest: (a) filter threads BY author, since with multiple reviewers you must attribute each thread to the reviewer who opened it; (b) GitHub does NOT auto-resolve threads when you push (they go `isOutdated:true` but stay `isResolved:false`), and a pushed-back or deferred thread left open would keep its author `needs-work` forever, so it MUST be resolved-with-rationale or escalated to a follow-up issue, never left dangling.

When a watch cycle reports a reviewer as `needs-work`, run this loop:

1. **Fetch the unresolved, non-outdated threads** authored by that reviewer (== the new work):
   ```bash
   # first:100 + cursor pagination; first:50 silently truncates on long-running PRs.
   gh api graphql -f query='query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:1){nodes{author{login} body path line}}}}}}}' \
     -f o=<OWNER> -f r=<REPO> -F n=$PR_NUM \
     --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false)'
   # If pageInfo.hasNextPage, fetch the next page with -f c=<endCursor> until exhausted before processing.
   ```
2. **Read** each thread + the cited code (always pull the actual file, never trust just the summary).
3. **Decide** per thread: address it, push back with reasoning, or ask the user.
4. **If addressing**: edit, run tests, commit (`fix(review): <what>`), push.
5. **MANDATORY: resolve every thread you fixed in the SAME push** (no REST equivalent exists):
   ```bash
   gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \
     -f tid="<THREAD_ID>"   # PRRT_... node id from step 1
   ```
   - A thread you **pushed back on** or **deferred** is NOT left dangling: either post a rationale comment and resolve it (so it stops counting against the predicate), or convert it to a follow-up issue and resolve it with a link. Leaving it open blocks done forever.
   - **Do NOT resolve** a thread you did not address and have not consciously dispositioned; that is still live discussion signal.
6. **Re-request the configured set** (same `requestReviews` mutation as step 4, `union:true`) so each reviewer re-reviews the new HEAD, then stay in the foreground watch.

**Pagination gotcha:** A long-running PR can accumulate >50 review threads. `first:50` (or smaller) silently drops threads beyond the page boundary; the API reports "0 unresolved" while the UI still shows open threads. Always paginate via `pageInfo.hasNextPage` + `endCursor` until exhausted before declaring the predicate met.

## Re-requesting review after a push

After every meaningful push that addresses a comment, re-request the WHOLE configured set (Copilot picks up the new push automatically, but explicit re-request reduces ambiguity for human reviewers and forces each reviewer's latest review onto the new HEAD, which is what predicate (1) checks):

```bash
# Same requestReviews mutation as step 4 above (userIds + teamIds + botIds); union:true preserves previous requests.
```

## Halt conditions

Stop the loop and report to the user when:

- Exit predicate holds → success; ask user "ready to merge?". When `subagent_review` is on, this is the merge-prep point where the optional conformance-review gate applies: offer a parallel-subagent review of the built work against the plan before declaring the PR ready (see [`agents-orchestration.md`](agents-orchestration.md), "Optional review gates").
- 24 hours elapsed since the loop started → "stalled, no progress, please advise".
- User explicitly says stop / changes course → obey.
- Branch protection blocks the merge despite the predicate holding → escalate; this means the rule set is stricter than the methodology assumed.

**Never** return control to the user just because a single cycle reported no change. That is not a halt condition. See "Things that look like a valid pause but are NOT" above.

## Guardrails

- **Never** force-push without explicit user authorization.
- **Never** skip pre-commit / pre-push hooks (`--no-verify`).
- **Never** merge yourself (`gh pr merge`) - merge is human-gated. See [`audit-vs-execute.md`](audit-vs-execute.md). User says "merge" / "ship it" / "go ahead" before any merge action.
- Dependabot alerts + CI failures block the PR; address them before declaring exit predicate true.
