import { createGh } from "../../plugins/github-dev-methodology/skills/github-dev-methodology/scripts/lib/gh.mjs";

const PAGE_SIZE = 100;

export function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, out, err };
}

export class FakeGithub {
  issues = new Map();
  graphqlCalls = [];

  add(key, fields = {}) {
    const [slug, number] = key.split("#");
    this.issues.set(key, {
      number: Number(number),
      title: `Issue ${key}`,
      state: "OPEN",
      body: "",
      issueType: null,
      labels: [],
      parent: null,
      subIssues: [],
      blockedBy: [],
      slug,
      ...fields,
    });
    return this;
  }

  link(parentKey, childKey) {
    this.issues.get(parentKey).subIssues.push(childKey);
    this.issues.get(childKey).parent = parentKey;
    return this;
  }

  node(key) {
    const issue = this.issues.get(key);
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      repository: { nameWithOwner: issue.slug },
      parent: issue.parent ? this.reference(issue.parent) : null,
    };
  }

  reference(key) {
    const issue = this.issues.get(key);
    return { number: issue.number, repository: { nameWithOwner: issue.slug } };
  }

  connection(keys, cursor) {
    const start = cursor ? Number(cursor) : 0;
    const end = start + PAGE_SIZE;
    return {
      nodes: keys.slice(start, end).map((key) => this.node(key)),
      pageInfo: { hasNextPage: end < keys.length, endCursor: end < keys.length ? String(end) : null },
    };
  }

  lookup({ owner, repo, number }) {
    return this.issues.get(`${owner}/${repo}#${number}`.toLowerCase()) ? `${owner}/${repo}#${number}`.toLowerCase() : null;
  }

  answer(query, variables) {
    if (query.includes("subIssues(first")) return this.answerRelations(variables, "subIssues");
    if (query.includes("blockedBy(first")) return this.answerRelations(variables, "blockedBy");
    if (query.includes("issues(first")) return this.answerList(variables);
    return this.answerSingle(variables);
  }

  answerRelations(variables, relation) {
    const key = this.lookup(variables);
    if (!key) return { repository: { issue: null } };
    const issue = this.issues.get(key);
    return { repository: { issue: { ...this.node(key), [relation]: this.connection(issue[relation], variables.cursor) } } };
  }

  answerList({ owner, repo, states, cursor }) {
    const keys = [...this.issues.keys()].filter((key) => {
      const issue = this.issues.get(key);
      return issue.slug === `${owner}/${repo}`.toLowerCase() && states.includes(issue.state);
    });
    const page = this.connection(keys, cursor);
    page.nodes = page.nodes.map((_, index) => this.fullIssue(keys[Number(cursor ?? 0) + index]));
    return { repository: { issues: page } };
  }

  answerSingle(variables) {
    const key = this.lookup(variables);
    return { repository: { issue: key ? this.fullIssue(key) : null } };
  }

  fullIssue(key) {
    const issue = this.issues.get(key);
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body,
      issueType: issue.issueType ? { name: issue.issueType } : null,
      labels: { nodes: issue.labels.map((name) => ({ name })) },
    };
  }

  runner = (args, { input } = {}) => {
    const { query, variables } = JSON.parse(input);
    this.graphqlCalls.push({ query, variables });
    return { status: 0, stdout: JSON.stringify({ data: this.answer(query, variables) }), stderr: "" };
  };

  gh() {
    return createGh(this.runner);
  }
}
