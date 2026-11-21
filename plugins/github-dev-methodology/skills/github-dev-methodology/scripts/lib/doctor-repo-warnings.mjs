import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasBlock } from "./agents-md.mjs";

const finding = (level, message) => ({ level, message });
const COPILOT_LOGIN = /copilot/i;
const RECENT_MERGED_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:MERGED,first:10,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number reviews(first:30){nodes{author{login}}}}}}}`;

async function guarded(label, action) {
  try {
    return await action();
  } catch (error) {
    return [finding("warn", `${label}: ${error.message}`)];
  }
}

export function checkDeleteBranchOnMerge(gh, project) {
  const slug = `${project.org}/${project.primary_repo}`;
  return guarded(`could not read repository settings for ${slug}`, async () => {
    const repository = await gh.rest("GET", `repos/${slug}`);
    if (repository?.delete_branch_on_merge !== false) return [];
    return [finding("warn", `delete_branch_on_merge is off on ${slug}; enable it: gh repo edit ${slug} --delete-branch-on-merge`)];
  });
}

export function checkCopilotActivity(gh, project) {
  const slug = `${project.org}/${project.primary_repo}`;
  return guarded(`could not read recent merged pull requests for ${slug}`, async () => {
    const data = await gh.graphql(RECENT_MERGED_QUERY, { owner: project.org, name: project.primary_repo });
    const pullRequests = data?.repository?.pullRequests?.nodes ?? [];
    const reviewed = pullRequests.filter((pr) =>
      (pr.reviews?.nodes ?? []).some((review) => COPILOT_LOGIN.test(review.author?.login ?? "")),
    );
    if (pullRequests.length === 0 || reviewed.length > 0) return [];
    return [finding("warn", `copilot_review is on but Copilot reviewed 0 of the last ${pullRequests.length} merged PRs on ${slug}`)];
  });
}

export function checkAgentsBlock(root) {
  const path = join(root, "AGENTS.md");
  const present = existsSync(path) && hasBlock(readFileSync(path, "utf8"));
  return present ? [] : [finding("warn", "AGENTS.md has no gdm marker block; run: gdm init")];
}
