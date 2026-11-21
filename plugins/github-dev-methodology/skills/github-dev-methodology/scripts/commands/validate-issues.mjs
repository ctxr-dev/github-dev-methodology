import { UsageError } from "../lib/errors.mjs";
import { EPIC_SECTIONS, REGULAR_SECTIONS, isEpic, missingSections } from "../lib/issue-headings.mjs";
import { fetchIssues, listIssues } from "../lib/issue-list.mjs";
import { parseRepoSlug } from "../lib/issue-ref.mjs";
import { assetPath } from "../lib/skill-dir.mjs";
import { parseValidateArgs } from "../lib/validate-args.mjs";

const STATES = ["open", "all"];

function parseTouched(text) {
  const numbers = text.split(",").map((part) => part.trim());
  if (numbers.length === 0 || numbers.some((part) => !/^\d+$/.test(part))) {
    throw new UsageError(`--touched expects comma-separated issue numbers, got "${text}"`);
  }
  return [...new Set(numbers.map(Number))];
}

function inspect(issue) {
  const epic = isEpic(issue);
  const missing = missingSections(issue.body, epic ? EPIC_SECTIONS : REGULAR_SECTIONS);
  const template = assetPath(epic ? "epic-body.md" : "issue-body.md");
  return { number: issue.number, title: issue.title ?? "", epic, missing, template };
}

export async function run(args, ctx) {
  const { positionals, flags } = parseValidateArgs(args, { values: ["touched", "state"] });
  if (positionals.length !== 1) throw new UsageError("usage: gdm validate issues <owner/repo> [--touched 1,2] [--state open|all]");
  const slug = parseRepoSlug(positionals[0]);
  const touched = flags.touched === undefined ? null : parseTouched(flags.touched);
  if (flags.state !== undefined && !STATES.includes(flags.state)) {
    throw new UsageError(`--state must be one of ${STATES.join(", ")}`);
  }
  const state = flags.state ?? (touched ? "all" : "open");
  const fetched = touched ? await fetchIssues(ctx.gh, slug, touched) : await listIssues(ctx.gh, slug, state);
  const issues = fetched.filter((issue) => state === "all" || issue.state === "OPEN");
  const results = issues.map(inspect);
  const failures = results.filter((result) => result.missing.length > 0);
  const repo = `${slug.owner}/${slug.repo}`;
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ ok: failures.length === 0, repo, checked: results.length, failures })}\n`);
  } else if (failures.length === 0) {
    ctx.stdout.write(`issues ok: ${results.length} checked in ${repo}\n`);
  }
  for (const failure of failures) {
    const kind = failure.epic ? "epic " : "";
    const headings = failure.missing.map((name) => `## ${name}`).join(", ");
    ctx.stderr.write(`issues: #${failure.number} ${kind}"${failure.title}": missing ${headings} (template: ${failure.template})\n`);
  }
  return failures.length === 0 ? 0 : 1;
}
