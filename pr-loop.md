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

The loop terminates iff ALL three hold:

1. **Every required reviewer** (effective list = configured `required_reviewers` + CODEOWNERS hits on changed paths) has `approved` review status.
2. **The reviewer's last review is on the current HEAD AND contains zero new comments.** Check via:
   ```graphql
   reviews(last:1) { nodes { commit { oid } comments(first:10) { totalCount } } }
   ```
   Exit only when `commit.oid == <HEAD SHA>` AND `comments.totalCount == 0`. **Resolving a thread is a UI affordance, not the exit signal** — `resolveReviewThread` collapses the thread but does not delete its comments, so a resolved thread still contributes to `comments.totalCount`. Check thread-resolution as a hygiene step (so the PR UI is clean for the human merger), but don't conflate it with the exit predicate.
3. **CI status: success** for the head SHA.

Otherwise: keep iterating.

### Things that look like exit but are NOT exit

These are common false-positives. None of them, alone or in any combination, satisfies the predicate above:

- ❌ **CI green** — necessary, not sufficient. Predicate (2) is independent of CI.
- ❌ **`mergeable: MERGEABLE` / `mergeStateStatus: CLEAN`** — only means there are no merge conflicts and required checks pass. It says nothing about review comments.
- ❌ **All review threads `isResolved: true`** — resolution is a UI affordance (see above). Resolved threads still count toward `comments.totalCount`.
- ❌ **Reviewer's last review has 0 new comments, but on a STALE commit** — predicate (2) requires the review to be on the current HEAD SHA. A stale "0 comments" review is not exit.
- ❌ **No new comments since the last push** — silence isn't approval. Predicate (1) requires `state == APPROVED`. For Copilot specifically, there is no `APPROVED` state, so the effective signal is "review on HEAD with zero comments AND no further re-request needed".
- ❌ **You believe the remaining comments are out of scope** — that's a conversation to have with the user via PR comment, not a reason to declare exit. Out-of-scope feedback either gets pushed back on (leave the thread open as discussion signal) or deferred to a follow-up issue, but the predicate doesn't bend.

Until predicate (1) AND (2) AND (3) all hold, the PR is **NOT ready for merge** — even if the diff feels finished, even if the human reviewer is idle. Report current state honestly ("CI green, mergeable, but reviewer left N comments on HEAD") and continue the loop, or escalate per the halt conditions below.

## Polling cadence

- **Check every 5 minutes** while the loop is active.
- **Maximum 24 hours** without a state change before halt-and-ask the user. Idle reviewer time is normal; don't give up early.
- "No new comments this cycle" is NOT a reason to stop or to return control to the user — keep polling.
- **Polling is foreground and blocking.** The agent MUST keep the loop in the foreground for the entire run. Use a blocking `sleep 300` (or your harness's foreground-blocking equivalent) inside a `while true` loop. The only exits are: (a) exit predicate holds, (b) 24h elapsed, (c) user interrupts the run.

### Things that look like a valid pause but are NOT

These are common false exits. None of them is permitted — every one of them leaves the user nudging the agent to keep going, which defeats the loop:

- ❌ **"I'll check back in 5 minutes."** Returning control to the user between cycles. Not allowed; the loop must block in-process.
- ❌ **Scheduling a wake-up / callback / cron and returning.** The harness's async wake-up primitives are NOT the polling mechanism. Use blocking `sleep` inside the loop.
- ❌ **Marking the PR or task as "done" while waiting for review.** The loop is not done until the exit predicate (or 24h, or user interrupt) fires.
- ❌ **Asking the user to confirm CI status, reviewer state, or thread resolution.** The agent reads that itself each cycle.
- ❌ **Treating a single no-change cycle as a halt condition.** Silence is normal; keep going.

If a single cycle reports no progress, the agent re-sleeps and re-polls. It does NOT report back to the user and wait for a prompt.

## Reviewer auto-discovery (run once per project, cache in local config)

> **Skip the Copilot branch (step 1) if `copilot_review` is off in the active project.** In that case start from step 2 and go straight to a human reviewer from config or "ask".

Order of precedence:

1. **Copilot is available?** *(only if `copilot_review` is on)* Check via `gh api graphql -f query='{ repository(owner: "<OWNER>", name: "<REPO>") { pullRequest(first: 1) { nodes { reviews(first: 5) { nodes { author { __typename login } } } } } } }'`. Filter for `__typename == "Bot" && login == "copilot-pull-request-reviewer"`. If found, capture the bot node id (see `commits.md` for the extraction snippet).
2. **Configured `default_reviewer` in `.agents/ctxr-dev/github-dev-methodology.config.local.md`?** Use it.
3. **Ask the user** which reviewer(s) to use. **Persist the answer** to `.agents/ctxr-dev/github-dev-methodology.config.local.md` so future sessions don't re-ask.

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

# 4. Trigger review (Copilot + humans). For Copilot, use GraphQL botIds (NOT REST):
COPILOT_ID=<from-config-or-discovery>  # e.g. BOT_kgDOXXXXXX (per-installation; see commits.md)
PR_NUM=<number>
PR_ID=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=$PR_NUM --jq '.data.repository.pullRequest.id')
gh api graphql -f query='mutation($pid:ID!,$bots:[ID!]!){requestReviews(input:{pullRequestId:$pid,botIds:$bots,union:true}){pullRequest{reviewRequests(first:10){nodes{requestedReviewer{__typename ... on Bot{login} ... on User{login}}}}}}}' \
  -f pid="$PR_ID" -f bots="$COPILOT_ID"

# 5. Poll every 5 min until exit predicate holds.
# Foreground polling — DO NOT replace the sleep with a wake-up tool or callback that
# returns control to the user. The loop blocks in-process until exit predicate / 24h / interrupt.
while true; do
  STATE=$(gh pr view $PR_NUM --repo <OWNER>/<REPO> \
    --json reviewDecision,reviews,reviewThreads,statusCheckRollup,mergeable)
  if echo "$STATE" | jq -e '<exit-predicate>' > /dev/null; then break; fi
  # else: address comments, push fix, resolve threads (see below), then re-sleep
  sleep 300
done
```

## Addressing review comments

For each new comment from the reviewer:

1. **Read** the comment + the cited code (always pull the actual file, never trust just the summary).
2. **Decide**: address the comment OR push back with reasoning OR ask user.
3. **If addressing**: edit, run tests, commit (`fix(review): <what>`), push.
4. **Resolve the thread** in the SAME turn as the push:
   ```bash
   # 1. Fetch unresolved threads. Use first:100 + cursor pagination — first:50 silently truncates on long-running PRs.
   gh api graphql -f query='query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){totalCount pageInfo{hasNextPage endCursor} nodes{id isResolved comments(first:1){nodes{body path line}}}}}}}' \
     -f o=<OWNER> -f r=<REPO> -F n=$PR_NUM --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
   # If pageInfo.hasNextPage, fetch the next page with -f c=<endCursor> until exhausted, then collect all unresolved IDs.

   # 2. For each thread you fixed, resolve via GraphQL (NO REST equivalent exists):
   gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \
     -f tid="<THREAD_ID>"   # PRRT_... node id from step 1
   ```
   **Pagination gotcha:** A long-running PR can accumulate >50 review threads. `first:50` (or smaller) silently drops threads beyond the page boundary. The API will report "0 unresolved" while the PR UI still shows open threads. Always paginate via `pageInfo.hasNextPage` + `endCursor` until exhausted before declaring the predicate met.
5. **Do NOT resolve** threads you didn't fix — leave them open as discussion signal.

## Re-requesting review after a push

After every meaningful push that addresses a comment, re-request the reviewer (Copilot picks up the new push automatically, but explicit re-request reduces ambiguity for human reviewers):

```bash
# Same requestReviews mutation as step 4 above; union:true preserves previous requests.
```

## Halt conditions

Stop the loop and report to the user when:

- Exit predicate holds → success; ask user "ready to merge?".
- 24 hours elapsed since the loop started → "stalled, no progress, please advise".
- User explicitly says stop / changes course → obey.
- Branch protection blocks the merge despite the predicate holding → escalate; this means the rule set is stricter than the methodology assumed.

**Never** return control to the user just because a single cycle reported no change. That is not a halt condition. See "Things that look like a valid pause but are NOT" above.

## Guardrails

- **Never** force-push without explicit user authorization.
- **Never** skip pre-commit / pre-push hooks (`--no-verify`).
- **Never** merge yourself (`gh pr merge`) — merge is human-gated. See [`audit-vs-execute.md`](audit-vs-execute.md). User says "merge" / "ship it" / "go ahead" before any merge action.
- Dependabot alerts + CI failures block the PR; address them before declaring exit predicate true.
