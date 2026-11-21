import { GhError } from "./errors.mjs";

const FIELDS = "number title state body issueType{name} labels(first:50){nodes{name}}";

const LIST_QUERY = `query($owner:String!,$repo:String!,$states:[IssueState!],$cursor:String){
  repository(owner:$owner,name:$repo){issues(first:100,after:$cursor,states:$states){
    nodes{${FIELDS}} pageInfo{hasNextPage endCursor}}}}`;

const SINGLE_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){issue(number:$number){${FIELDS}}}}`;

export async function listIssues(gh, { owner, repo }, state) {
  const states = state === "all" ? ["OPEN", "CLOSED"] : ["OPEN"];
  return gh.graphqlPaginated(LIST_QUERY, { owner, repo, states }, "repository.issues");
}

export async function fetchIssues(gh, { owner, repo }, numbers) {
  const issues = [];
  for (const number of numbers) {
    const data = await gh.graphql(SINGLE_QUERY, { owner, repo, number });
    const issue = data?.repository?.issue;
    if (!issue) throw new GhError(`issue not found: ${owner}/${repo}#${number}`);
    issues.push(issue);
  }
  return issues;
}
