#!/usr/bin/env node
// pr-review-watch.mjs --pr owner/name#N [--pr ...] --reviewer <login> [--reviewer ...] [opts]
//
// Foreground, multi-PR, multi-reviewer review watch. The no-MCP fallback for the
// gh_pr_review_watch tool: same predicate (latestReviews + unresolved-non-outdated
// threads authored by the reviewer), computed with the gh CLI.
//
// This is a single long-running FOREGROUND process. It polls internally every
// --interval seconds, holding last-seen per-reviewer state in memory (so it needs
// no fingerprint and cannot hot-loop), and blocks until the watched PRs are done,
// --max-wait elapses, or it is interrupted. It NEVER schedules a wake-up, forks to
// the background, or returns control to the caller mid-watch.
//
// Predicate (mirrors the mcp-github gh_pr_review_watch tool EXACTLY). Per configured
// reviewer, take their latest review via the `latestReviews` connection, excluding
// DISMISSED and PENDING:
//   - pending:    no such review whose commit.oid == headRefOid.
//   - needs-work: on head AND (CHANGES_REQUESTED OR >=1 reviewThread with
//                 isResolved==false && isOutdated==false whose first comment author
//                 is this reviewer).
//   - green:      on head AND not needs-work; if in --required, also APPROVED.
// The exit signal is unresolved non-outdated threads BY the reviewer, NOT
// review.comments.totalCount (that field undercounts and misses Copilot findings).
//
// A PR is `ready` (done) when every configured reviewer is non-pending AND green,
// every --required reviewer is APPROVED, and (with --require-ci) CI is SUCCESS.
//
// Usage:
//   node pr-review-watch.mjs --pr owner/repo#12 --reviewer copilot
//   node pr-review-watch.mjs --pr o/r#12 --pr o/r#15 --reviewer copilot --reviewer alice \
//     --required alice --wait-for all --interval 60 --max-wait 86400 --require-ci
//   node pr-review-watch.mjs --pr o/r#12 --reviewer copilot --once --json
//
// Args:
//   --pr owner/name#N   repeatable; at least one required.
//   --reviewer <login>  repeatable; at least one required. Alias `copilot` expands to
//                       `copilot-pull-request-reviewer`.
//   --required <login>  repeatable; subset of reviewers whose APPROVED gates done
//                       (humans only; bots have no APPROVED state). Default: the
//                       human reviewers (every --reviewer except the copilot bot).
//   --no-required       gate done on NO approvals (advisory-only humans). Mutually
//                       exclusive with --required.
//   --wait-for <mode>   any (default) | smart | all | quorum:N. Selects which wake
//                       transitions return control between cycles (does NOT relax done).
//   --interval <sec>    poll cadence between cycles (default 60).
//   --max-wait <sec>    give up after this many seconds (default: unlimited). Exit 2.
//   --once              single snapshot; print state and exit (0 if all ready, else 3).
//   --require-ci        require statusCheckRollup == SUCCESS for done.
//   --json              emit one JSON object per cycle instead of human text.

import { ghGraphql } from "./lib/gh.mjs";

const COPILOT_LOGIN = "copilot-pull-request-reviewer";

function usage(msg) {
  if (msg) console.error(`pr-review-watch.mjs: ${msg}`);
  console.error(
    "Usage: pr-review-watch.mjs --pr owner/name#N [--pr ...] --reviewer <login> [--reviewer ...]\n" +
      "                          [--required <login> ...] [--no-required] [--wait-for any|smart|all|quorum:N]\n" +
      "                          [--interval 60] [--max-wait <sec>] [--once] [--require-ci] [--json]"
  );
  process.exit(1);
}

// --- arg parse (mirrors diff-plan.mjs / validate-tree.mjs: usage to stderr, exit 1) ---

function parseArgs(argv) {
  const opts = {
    prs: [],
    reviewers: [],
    required: [],
    noRequired: false,
    waitFor: "any",
    quorum: 0,
    interval: 60,
    maxWait: 0,
    once: false,
    requireCi: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--pr":
        opts.prs.push(parsePrSpec(next()));
        break;
      case "--reviewer":
        opts.reviewers.push(normalizeReviewer(next()));
        break;
      case "--required":
        opts.required.push(normalizeReviewer(next()));
        break;
      case "--wait-for":
        setWaitFor(opts, next());
        break;
      case "--interval":
        opts.interval = parsePositiveInt(next(), "--interval");
        break;
      case "--max-wait":
        opts.maxWait = parsePositiveInt(next(), "--max-wait");
        break;
      case "--once":
        opts.once = true;
        break;
      case "--no-required":
        opts.noRequired = true;
        break;
      case "--require-ci":
        opts.requireCi = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        usage(`unknown argument: ${a}`);
    }
  }
  if (opts.prs.length === 0) usage("at least one --pr owner/name#N is required");
  if (opts.reviewers.length === 0) usage("at least one --reviewer is required");
  // Dedupe reviewers/required while preserving order.
  opts.reviewers = [...new Set(opts.reviewers)];
  opts.required = [...new Set(opts.required)];
  const reviewerSet = new Set(opts.reviewers);
  for (const r of opts.required) {
    if (!reviewerSet.has(r)) usage(`--required ${r} is not in the --reviewer set`);
  }
  if (opts.noRequired && opts.required.length > 0) {
    usage("--no-required cannot be combined with --required");
  }
  // Default the required-approver set to the human reviewers (every reviewer
  // except the copilot bot login) unless --no-required is given, matching the
  // gh_pr_review_watch tool (omitted requiredApprovals -> the humans; an
  // explicit empty set -> no required approvers). A human's "green" must also
  // be APPROVED for done, which avoids an all-green / zero-approvals state that
  // branch protection would reject. Bots have no APPROVED state, so never required.
  if (opts.required.length === 0 && !opts.noRequired) {
    opts.required = opts.reviewers.filter((r) => r !== COPILOT_LOGIN);
  }
  return opts;
}

function parsePrSpec(spec) {
  // owner/name#N or a full PR URL.
  const m = spec.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) };
  const url = spec.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  usage(`unparseable --pr spec: ${spec} (want owner/name#N)`);
}

function normalizeReviewer(login) {
  const v = login.trim();
  if (v === "") usage("empty reviewer login");
  return v.toLowerCase() === "copilot" ? COPILOT_LOGIN : v;
}

function setWaitFor(opts, raw) {
  const v = raw.trim().toLowerCase();
  if (v === "any" || v === "smart" || v === "all") {
    opts.waitFor = v;
    return;
  }
  const q = v.match(/^quorum:(\d+)$/);
  if (q) {
    const n = Number(q[1]);
    if (n < 1) usage("--wait-for quorum:N requires N >= 1");
    opts.waitFor = "quorum";
    opts.quorum = n;
    return;
  }
  usage(`--wait-for must be any|smart|all|quorum:N (got ${raw})`);
}

function parsePositiveInt(raw, flag) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} must be a positive integer (got ${raw})`);
  return n;
}

// --- predicate (mirrors gh_pr_review_watch) ---

const WATCH_QUERY = `query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      headRefOid
      reviewDecision
      latestReviews(first:30){nodes{author{login} state commit{oid} submittedAt}}
      reviewThreads(first:100,after:$c){
        pageInfo{hasNextPage endCursor}
        nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}
      }
      commits(last:1){nodes{commit{statusCheckRollup{state}}}}
    }
  }
}`;

function fetchPr(pr) {
  // Fetch head + reviews + threads in the SAME query (avoid a head-vs-reviews race),
  // paginating reviewThreads past the first 100.
  const first = ghGraphql(WATCH_QUERY, { o: pr.owner, r: pr.repo, n: pr.number, c: "" });
  const node = first.data?.repository?.pullRequest;
  if (!node) throw new Error(`PR not found: ${pr.owner}/${pr.repo}#${pr.number}`);
  const threads = [...node.reviewThreads.nodes];
  let page = node.reviewThreads.pageInfo;
  while (page.hasNextPage) {
    const r = ghGraphql(WATCH_QUERY, {
      o: pr.owner,
      r: pr.repo,
      n: pr.number,
      c: page.endCursor,
    });
    const tn = r.data.repository.pullRequest.reviewThreads;
    threads.push(...tn.nodes);
    page = tn.pageInfo;
  }
  return {
    head: node.headRefOid,
    reviewDecision: node.reviewDecision,
    latestReviews: node.latestReviews.nodes,
    threads,
    ci: node.commits.nodes[0]?.commit?.statusCheckRollup?.state ?? null,
  };
}

// Lowercase-compare logins so `--reviewer Alice` matches `alice`.
function sameLogin(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function evaluatePr(raw, opts) {
  const requiredSet = new Set(opts.required.map((r) => r.toLowerCase()));
  const reviewers = opts.reviewers.map((login) => {
    // Latest review by this reviewer, excluding DISMISSED/PENDING (per the locked model).
    const review = raw.latestReviews.find(
      (rv) =>
        sameLogin(rv.author?.login, login) &&
        rv.state !== "DISMISSED" &&
        rv.state !== "PENDING"
    );
    const onHead = !!review && review.commit?.oid === raw.head;
    // Unresolved, non-outdated threads whose first comment author is this reviewer.
    const unresolvedByReviewer = raw.threads.filter(
      (t) =>
        t.isResolved === false &&
        t.isOutdated === false &&
        sameLogin(t.comments?.nodes?.[0]?.author?.login, login)
    ).length;

    let verdict;
    if (!onHead) {
      verdict = "pending";
    } else if (review.state === "CHANGES_REQUESTED" || unresolvedByReviewer > 0) {
      verdict = "needs-work";
    } else {
      // On head, no open thread, no requested changes: green. The verdict
      // reflects review feedback only; a required approver who has not yet
      // APPROVED is still green and is held back by the separate
      // required-approval gate below (mirrors the gh_pr_review_watch tool).
      verdict = "green";
    }
    return {
      login,
      onHead,
      state: review?.state ?? null,
      unresolvedByReviewer,
      verdict,
    };
  });

  const onHeadCount = reviewers.filter((r) => r.onHead).length;
  const actionable = reviewers.some((r) => r.verdict === "needs-work");
  const allGreen = reviewers.every((r) => r.verdict === "green");
  // Required approvers must additionally be APPROVED for done (humans only;
  // bots have no APPROVED state and are never defaulted into the required set).
  const requiredApproved = reviewers
    .filter((r) => requiredSet.has(r.login.toLowerCase()))
    .every((r) => r.state === "APPROVED");
  const ciOk = !opts.requireCi || raw.ci === "SUCCESS";
  const ready = allGreen && requiredApproved && ciOk;

  return {
    head: raw.head,
    reviewDecision: raw.reviewDecision,
    ci: raw.ci,
    reviewers,
    onHeadCount,
    actionable,
    ready,
    // Stable per-PR state string: feeds in-process wake detection (no hashing needed).
    state: reviewers
      .map((r) => `${r.login}:${r.onHead ? raw.head : "-"}:${r.verdict}`)
      .sort()
      .join("|") + `|ci:${raw.ci ?? "-"}`,
  };
}

// --- wake (in-process; compares this cycle's state to the previous one) ---

function isWake(prev, cur, opts) {
  if (cur.ready) return true;
  if (!prev) return false; // first cycle is a baseline, not a wake
  if (prev.state === cur.state) return false; // no transition: keep waiting
  switch (opts.waitFor) {
    case "all":
      return cur.onHeadCount === cur.reviewers.length;
    case "quorum":
      return cur.onHeadCount >= opts.quorum;
    case "smart":
      return cur.actionable || cur.ready;
    case "any":
    default:
      return true;
  }
}

// --- reporting ---

function prLabel(pr) {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

function reviewerSummary(ev) {
  return ev.reviewers
    .map((r) => {
      const note =
        r.verdict === "needs-work" && r.unresolvedByReviewer > 0
          ? `${r.verdict}(${r.unresolvedByReviewer})`
          : r.verdict;
      return `${r.login}=${note}`;
    })
    .join(" ");
}

function printHuman(results, elapsed) {
  const stamp = new Date().toISOString();
  for (const { pr, ev, error } of results) {
    if (error) {
      console.log(`[${stamp}] ${prLabel(pr)} ERROR ${error}`);
      continue;
    }
    const flags = [
      ev.ready ? "READY" : ev.actionable ? "actionable" : "waiting",
      `ci:${ev.ci ?? "none"}`,
    ].join(" ");
    console.log(
      `[${stamp}] ${prLabel(pr)} head ${ev.head.slice(0, 7)} ${flags} | ${reviewerSummary(ev)}`
    );
  }
  console.log(`  (+${elapsed}s elapsed)`);
}

function printJson(results, elapsed, done) {
  const out = {
    ts: new Date().toISOString(),
    elapsedSeconds: elapsed,
    done,
    items: results.map(({ pr, ev, error }) =>
      error
        ? { repo: `${pr.owner}/${pr.repo}`, number: pr.number, error }
        : { repo: `${pr.owner}/${pr.repo}`, number: pr.number, ...ev }
    ),
  };
  console.log(JSON.stringify(out));
}

function sleep(seconds, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, seconds * 1000);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    }
  });
}

// --- watch loop (single foreground process; internal sleep; cannot hot-loop) ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const ac = new AbortController();
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    ac.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const prev = new Map(); // prLabel -> previous evaluation (in-process state)
  const start = Date.now();
  let cycle = 0;

  while (true) {
    cycle++;
    const results = [];
    let wake = false;
    for (const pr of opts.prs) {
      const label = prLabel(pr);
      try {
        const ev = evaluatePr(fetchPr(pr), opts);
        results.push({ pr, ev });
        if (isWake(prev.get(label), ev, opts)) wake = true;
        prev.set(label, ev);
      } catch (err) {
        // One bad PR must never kill the batch.
        results.push({ pr, error: err.message });
        wake = true; // surface the error promptly rather than swallowing it
      }
    }

    const allReady =
      results.length > 0 && results.every((r) => r.ev && r.ev.ready);
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (opts.json) printJson(results, elapsed, allReady);
    else printHuman(results, elapsed);

    if (allReady) {
      cleanup(onSignal);
      process.exit(0);
    }
    if (opts.once) {
      cleanup(onSignal);
      // --once is a snapshot: exit 3 ("not ready yet") so callers can branch.
      process.exit(3);
    }
    if (interrupted) {
      console.error("pr-review-watch.mjs: interrupted; exiting.");
      cleanup(onSignal);
      process.exit(130);
    }
    if (opts.maxWait && elapsed >= opts.maxWait) {
      console.error(
        `pr-review-watch.mjs: max-wait ${opts.maxWait}s reached without all PRs ready.`
      );
      cleanup(onSignal);
      process.exit(2);
    }

    // `wake` selects which transitions are worth a between-cycle report; it never
    // shortens the sleep here (this is a single long-poll, not a re-invoked tool),
    // but it is the same signal a fingerprint-driven caller would key on.
    void wake;

    await sleep(opts.interval, ac.signal);
    if (interrupted) {
      console.error("pr-review-watch.mjs: interrupted; exiting.");
      cleanup(onSignal);
      process.exit(130);
    }
  }
}

function cleanup(onSignal) {
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
}

main().catch((err) => {
  console.error(`pr-review-watch.mjs: ${err.message}`);
  process.exit(1);
});
