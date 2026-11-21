import { GhError } from "./errors.mjs";
import { issueKey, refFromNode } from "./issue-ref.mjs";

const NODE_FIELDS = "number title state repository{nameWithOwner} parent{number repository{nameWithOwner}}";

const CHILDREN_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){issue(number:$number){
    ${NODE_FIELDS}
    subIssues(first:100,after:$cursor){nodes{${NODE_FIELDS}} pageInfo{hasNextPage endCursor}}
  }}}`;

const BLOCKERS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){issue(number:$number){
    ${NODE_FIELDS}
    blockedBy(first:100,after:$cursor){nodes{${NODE_FIELDS}} pageInfo{hasNextPage endCursor}}
  }}}`;

const parentKey = (node) => (node.parent ? issueKey(refFromNode(node.parent)) : null);

export function toSummary(node) {
  return {
    key: issueKey(refFromNode(node)),
    ref: refFromNode(node),
    title: node.title ?? "",
    state: node.state ?? "OPEN",
    parent: parentKey(node),
    parentRef: node.parent ? refFromNode(node.parent) : null,
  };
}

async function fetchConnection(gh, query, ref, connection) {
  const nodes = [];
  let issue = null;
  let cursor = null;
  for (;;) {
    const data = await gh.graphql(query, { owner: ref.owner, repo: ref.repo, number: ref.number, cursor });
    const page = data?.repository?.issue;
    if (!page) throw new GhError(`issue not found: ${ref.owner}/${ref.repo}#${ref.number}`);
    issue ??= page;
    const { nodes: pageNodes = [], pageInfo = {} } = page[connection] ?? {};
    nodes.push(...pageNodes);
    if (!pageInfo.hasNextPage) return { issue, nodes };
    if (!pageInfo.endCursor) throw new GhError(`${connection} reports another page without an endCursor`);
    cursor = pageInfo.endCursor;
  }
}

export async function fetchWithChildren(gh, ref) {
  const { issue, nodes } = await fetchConnection(gh, CHILDREN_QUERY, ref, "subIssues");
  return { ...toSummary(issue), children: nodes.map(toSummary) };
}

export async function fetchWithBlockers(gh, ref) {
  const { issue, nodes } = await fetchConnection(gh, BLOCKERS_QUERY, ref, "blockedBy");
  return { ...toSummary(issue), blockers: nodes.map(toSummary) };
}
