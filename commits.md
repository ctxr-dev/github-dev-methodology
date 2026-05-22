---
feature: conventional_commits
requires:
  features: []
  config: []
---

# Conventional commits + reviewer-request mechanics

## Conventional Commits 1.0 (MUST)

Every commit MUST follow `<type>(<scope>): <subject>`. Types:

- `feat(<scope>): <subject>` — new capability.
- `fix(<scope>): <subject>` — bug fix.
- `docs(<scope>): <subject>` — documentation only.
- `chore(<scope>): <subject>` — tooling, infra, dep bumps.
- `refactor(<scope>): <subject>` — internal restructure, no behaviour change.
- `test(<scope>): <subject>` — test additions/changes only.
- `style(<scope>): <subject>` — whitespace, formatting; no semantic change.
- `perf(<scope>): <subject>` — performance optimization.

Scope: a brief subsystem identifier (`scope: skill-name`, `scope: tracker-sync`, `scope: pr-iteration`, etc.). Optional but recommended.

Subject: imperative ("add X" not "added X"). ≤ 72 chars. Start lowercase except proper nouns.

Body (optional): explains WHY. Wrap at 72 chars. Reference the issue it closes via a footer line: `Closes: <OWNER>/<REPO>#<NUM>`.

### Multi-line example

```
feat(pr-iteration): autonomous mode exit on reviewer + CI predicate

Implements the canonical loop exit per pr-loop.md: terminates iff every
required reviewer has approved-no-comments AND CI status is success. Falls
back to interactive mode when --interactive flag is set.

Closes: ctxr-dev/agent-staff-engineer#52
```

## Reviewer auto-discovery + request

> **Skip this entire section if `copilot_review` is off in the active project.** The methodology then falls back to plain `gh pr edit --add-reviewer <login>` against the human named in `default_reviewer`, with no auto-discovery and no GraphQL `requestReviews` mutation.

The PR loop ([`pr-loop.md`](pr-loop.md)) requires triggering a code review after every push. The mechanism depends on the reviewer.

### 1. Detect Copilot availability (cache result per-project)

```bash
# Copilot is installed on a repo IFF a recent PR shows reviews authored by __typename "Bot" and login "copilot-pull-request-reviewer".
gh api graphql -f query='query($o:String!,$r:String!){repository(owner:$o,name:$r){pullRequests(first:5,states:[MERGED,OPEN]){nodes{reviews(first:5){nodes{author{__typename login ... on Bot{id}}}}}}}}' \
  -f o=<OWNER> -f r=<REPO> --jq '[.data.repository.pullRequests.nodes[].reviews.nodes[].author | select(.__typename == "Bot" and .login == "copilot-pull-request-reviewer")] | first | .id // "NOT_INSTALLED"'
```

If the result is a `BOT_...` ID: Copilot IS installed. Cache the bot node ID in `.agents/ctxr-dev/github-dev-methodology.config.local.md` under the `copilot_bot_id` key. Bot IDs are per-installation but stable until Copilot is uninstalled / reinstalled.

If the result is `NOT_INSTALLED`: skip Copilot. See "fallback" below.

### 2. Trigger Copilot review (CRITICAL — REST does NOT work)

REST `RequestReviewers` silently no-ops for Bot accounts. Empirical observations:

- ❌ `gh pr edit <num> --add-reviewer copilot-pull-request-reviewer` — REST rejects bot user IDs silently.
- ❌ `gh pr create --reviewer copilot-pull-request-reviewer` — same.
- ❌ `@copilot-pull-request-reviewer` mention in PR comment — handle doesn't resolve to a request.
- ❌ GraphQL `requestReviews(input: { userIds: [<bot-id>] })` — returns `NOT_FOUND` ("Could not resolve to User node"). `userIds` is for `User` nodes only.
- ✅ GraphQL `requestReviews(input: { botIds: [<bot-id>], union: true })` — works.

```bash
PR_NUM=<num>
PR_ID=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=$PR_NUM --jq '.data.repository.pullRequest.id')

gh api graphql -f query='mutation($pid:ID!,$bots:[ID!]!){requestReviews(input:{pullRequestId:$pid,botIds:$bots,union:true}){pullRequest{reviewRequests(first:10){nodes{requestedReviewer{__typename ... on Bot{login} ... on User{login}}}}}}}' \
  -f pid="$PR_ID" -f bots="$COPILOT_BOT_ID"
```

Notes:
- `union: true` preserves existing requests (additive, not destructive).
- Successful response: `{"data":{"requestReviews":{"pullRequest":{"reviewRequests":{"nodes":[]}}}}}`. The empty `nodes` is NOT a failure — it means Copilot consumed the request and moved into review state.
- Confirm by polling `gh pr view <num> --json reviews` after 30-60 seconds.

### 3. Discovery snippet for the bot node ID

```bash
# Pull from any PR Copilot has reviewed before:
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviews(first:10){nodes{author{__typename login ... on Bot{id}}}}}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<KNOWN_PR_NUM> \
  --jq '.data.repository.pullRequest.reviews.nodes[] | select(.author.__typename == "Bot" and .author.login == "copilot-pull-request-reviewer") | .author.id'
```

### 4. Fallback — when Copilot isn't installed

If Copilot isn't on the repo:

1. Check `.agents/ctxr-dev/github-dev-methodology.config.local.md` for `default_reviewer`. If set, use it.
2. If not set, ASK the user which human reviewer(s) to use (and write the answer back to the config).
3. Request via standard REST (works for human users):
   ```bash
   gh pr edit <num> --repo <OWNER>/<REPO> --add-reviewer <login>
   ```

## Resolving review threads after fixing

After a commit that addresses a reviewer's comment, resolve the thread in the same turn:

```bash
# 1. Pull unresolved threads. Use first:100 + cursor pagination — first:50 silently truncates on long PRs.
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){totalCount pageInfo{hasNextPage endCursor} nodes{id isResolved comments(first:1){nodes{body path line}}}}}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<PR_NUM> --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
# If pageInfo.hasNextPage, fetch the next page with -f c=<endCursor> until exhausted before processing.

# 2. For each thread you fixed, resolve via GraphQL (NO REST equivalent):
gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \
  -f tid="<PRRT_NODE_ID>"
```

**Pagination gotcha:** A long-running PR can accumulate >50 threads. `first:50` (or smaller) silently drops threads beyond the page boundary; the API reports "0 unresolved" while the UI still shows open threads. Always paginate.

Don't resolve threads you didn't address — those are signals you missed the point or want follow-up discussion.

## Why the GraphQL-only path

REST API endpoints for review-threads (e.g. `gh api repos/.../pulls/N/comments`) return review *comments*, not review *threads*. Only the GraphQL `reviewThreads` surface has the resolve mutation. There is NO REST shortcut. Don't go looking; you'll waste time.

### GraphQL as the default for all PR ops

Beyond review threads, prefer GraphQL for **all** PR mutations and state queries on this methodology: `requestReviews`, `resolveReviewThread`, fetching `pullRequest.reviewRequests` / `reviewThreads` / `reviews`, and discovering bot node IDs. REST endpoints (`POST /pulls/N/requested_reviewers`, `PATCH /pulls/N`) have shown inconsistent state propagation in field reports — reviewers appear added but downstream notifications don't fire, or state shows in API responses but not in the UI. REST is the fallback when GraphQL has no equivalent (rare admin endpoints); GraphQL is the default everywhere else.
