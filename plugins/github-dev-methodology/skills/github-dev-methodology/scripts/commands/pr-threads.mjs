import { loadPrContext, parseArgs, requirePrRefs } from "../lib/pr-args.mjs";
import { normalizeLogin } from "../lib/logins.mjs";
import { RESOLVE_THREAD_MUTATION, THREAD_LIST_QUERY } from "../lib/pr-queries.mjs";

const PREVIEW_LENGTH = 120;

function toThread(node) {
  const first = node.comments.nodes[0] ?? {};
  return {
    id: node.id,
    path: node.path ?? null,
    line: node.line ?? null,
    author: first.author?.login ?? null,
    body: first.body ?? "",
    url: first.url ?? null,
  };
}

function isOpenThread(node) {
  return node.isResolved === false && node.isOutdated === false;
}

async function listOpenThreads(gh, ref, author) {
  const nodes = await gh.graphqlPaginated(
    THREAD_LIST_QUERY,
    { o: ref.owner, r: ref.repo, n: ref.number },
    "repository.pullRequest.reviewThreads",
  );
  const threads = nodes.filter(isOpenThread).map(toThread);
  return author ? threads.filter((thread) => normalizeLogin(thread.author) === normalizeLogin(author)) : threads;
}

function formatThread(thread) {
  const location = thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ""}` : "(no path)";
  const preview = thread.body.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH);
  return `${thread.id} ${location} @${thread.author ?? "unknown"}: ${preview}`;
}

async function resolveThreads(ctx, ids) {
  let failed = false;
  for (const id of ids) {
    try {
      await ctx.gh.graphql(RESOLVE_THREAD_MUTATION, { id });
      ctx.stdout.write(`resolved: ${id}\n`);
    } catch (error) {
      failed = true;
      ctx.stderr.write(`resolve-failed: ${id}: ${error.message}\n`);
    }
  }
  return failed ? 1 : 0;
}

export async function run(args, ctx) {
  const { positionals, options } = parseArgs(args, { values: ["author", "project"], variadic: ["resolve"], flags: ["json"] });
  const { defaults } = loadPrContext(ctx, options.project);
  const [ref] = requirePrRefs(positionals, defaults, { max: 1 });
  if (options.resolve) return resolveThreads(ctx, options.resolve);
  const threads = await listOpenThreads(ctx.gh, ref, options.author);
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify(threads)}\n`);
  } else if (threads.length === 0) {
    ctx.stdout.write("no unresolved threads\n");
  } else {
    ctx.stdout.write(`${threads.map(formatThread).join("\n")}\n`);
  }
  return 0;
}
