import { loadRepoConfig } from "../lib/config.mjs";
import { UsageError } from "../lib/errors.mjs";
import { classifyLabels, listRepoLabels, loadLockedLabels, repairArgs } from "../lib/labels.mjs";
import { parseValidateArgs } from "../lib/validate-args.mjs";

function resolveRepos(flags, ctx) {
  if (flags.repos !== undefined) {
    const repos = flags.repos.split(",").map((name) => name.trim()).filter(Boolean);
    if (repos.length === 0) throw new UsageError("--repos needs at least one repo name");
    return repos;
  }
  const { project } = loadRepoConfig(ctx.cwd, { project: flags.project });
  return [project.primary_repo, ...project.sibling_repos];
}

async function repairLabel(entry, slug, ctx) {
  const result = await ctx.gh.cli(repairArgs(entry, slug));
  if (result.status === 0) return true;
  const detail = (result.stderr || result.stdout).trim();
  ctx.stderr.write(`labels: ${slug}: could not repair ${entry.want.name}: ${detail}\n`);
  return false;
}

async function checkRepo(owner, repo, locked, fix, ctx) {
  const slug = `${owner}/${repo}`;
  const entries = classifyLabels(locked, await listRepoLabels(ctx.gh, slug));
  const outcome = { repo: slug, drifts: 0, failedRepairs: 0, lines: [] };
  for (const entry of entries) {
    if (entry.status === "ok") {
      outcome.lines.push({ repo: slug, name: entry.want.name, status: "ok" });
      continue;
    }
    outcome.drifts += 1;
    const repaired = fix ? await repairLabel(entry, slug, ctx) : false;
    if (fix && !repaired) outcome.failedRepairs += 1;
    const status = fix ? (repaired ? "fixed" : "fix-failed") : entry.status;
    outcome.lines.push({ repo: slug, name: entry.want.name, status });
  }
  return outcome;
}

export async function run(args, ctx) {
  const { positionals, flags } = parseValidateArgs(args, { values: ["repos", "project"], booleans: ["fix"] });
  if (positionals.length !== 1) throw new UsageError("usage: gdm validate labels <owner> [--repos a,b] [--fix]");
  const owner = positionals[0];
  const repos = resolveRepos(flags, ctx);
  const locked = loadLockedLabels();
  const outcomes = [];
  for (const repo of repos) outcomes.push(await checkRepo(owner, repo, locked, flags.fix === true, ctx));
  const lines = outcomes.flatMap((outcome) => outcome.lines);
  const drifts = outcomes.reduce((sum, outcome) => sum + outcome.drifts, 0);
  const failedRepairs = outcomes.reduce((sum, outcome) => sum + outcome.failedRepairs, 0);
  const ok = flags.fix ? failedRepairs === 0 : drifts === 0;
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ ok, owner, repos, drifts, failedRepairs, labels: lines })}\n`);
  } else {
    for (const line of lines.filter((entry) => entry.status !== "ok")) {
      ctx.stdout.write(`${line.status.toUpperCase()} ${line.repo} ${line.name}\n`);
    }
    if (ok) ctx.stdout.write(`labels ok: ${locked.length} locked labels in ${repos.length} repos${flags.fix && drifts > 0 ? ` (${drifts} repaired)` : ""}\n`);
  }
  if (!ok) ctx.stderr.write(`labels: ${flags.fix ? failedRepairs + " repairs failed" : drifts + " drifts; run with --fix"}\n`);
  return ok ? 0 : 1;
}
