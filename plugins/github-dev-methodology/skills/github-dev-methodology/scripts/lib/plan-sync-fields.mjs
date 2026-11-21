import { GdmError } from "./errors.mjs";
import { parseProjectUrl } from "./plan-manifest.mjs";

const ISSUE_FIELD_TYPES = ["Text", "Number", "Date", "SingleSelect"];

const ISSUE_FIELD_DEFS_QUERY = `query IssueFieldDefs($owner: String!) {
  organization(login: $owner) {
    issueFields(first: 50) {
      nodes {
        __typename
        ... on IssueFieldText { id name }
        ... on IssueFieldNumber { id name }
        ... on IssueFieldDate { id name }
        ... on IssueFieldSingleSelect { id name options { id name } }
      }
    }
  }
}`;

const ISSUE_FIELD_VALUES_QUERY = `query IssueFieldValues($id: ID!) {
  node(id: $id) {
    ... on Issue {
      issueFieldValues(first: 50) {
        nodes {
          __typename
${ISSUE_FIELD_TYPES.map((type) => `          ... on IssueField${type}Value { value field { ... on IssueField${type} { name } } }`).join("\n")}
        }
      }
    }
  }
}`;

const SET_ISSUE_FIELDS_MUTATION = `mutation SetIssueFields($input: SetIssueFieldValueInput!) {
  setIssueFieldValue(input: $input) { clientMutationId }
}`;

const ADD_PROJECT_ITEM_MUTATION = `mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;

const UPDATE_PROJECT_FIELD_MUTATION = `mutation UpdateProjectField($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
}`;

const projectFieldsQuery = (scope) => `query ProjectFields($login: String!, $number: Int!) {
  ${scope}(login: $login) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField { id name dataType options { id name } }
          ... on ProjectV2IterationField { id name dataType }
        }
      }
    }
  }
}`;

function pickOption(definition, name, value) {
  const option = (definition.options ?? []).find((candidate) => candidate.name === String(value));
  if (!option) throw new GdmError(`field ${name}: no option named "${value}"`);
  return option.id;
}

function issueFieldInput(definition, value) {
  const base = { fieldId: definition.id };
  if (definition.type === "Text") return { ...base, textValue: String(value) };
  if (definition.type === "Number") return { ...base, numberValue: Number(value) };
  if (definition.type === "Date") return { ...base, dateValue: String(value) };
  return { ...base, singleSelectOptionId: pickOption(definition, definition.name, value) };
}

function projectFieldValue(definition, value) {
  if (definition.dataType === "TEXT") return { text: String(value) };
  if (definition.dataType === "NUMBER") return { number: Number(value) };
  if (definition.dataType === "DATE") return { date: String(value) };
  if (definition.dataType === "SINGLE_SELECT") return { singleSelectOptionId: pickOption(definition, definition.name, value) };
  throw new GdmError(`project field ${definition.name}: data type ${definition.dataType} is not supported`);
}

export function createFieldActions(gh, { pace, log }) {
  const issueFieldCache = new Map();
  const projectCache = new Map();

  async function issueFieldDefinitions(owner) {
    if (issueFieldCache.has(owner)) return issueFieldCache.get(owner);
    let definitions = null;
    try {
      const data = await gh.graphql(ISSUE_FIELD_DEFS_QUERY, { owner });
      const nodes = data?.organization?.issueFields?.nodes ?? [];
      if (nodes.length > 0) {
        definitions = new Map(nodes.map((node) => [node.name, { id: node.id, name: node.name, type: node.__typename.replace(/^IssueField/, ""), options: node.options }]));
      }
    } catch {
      definitions = null;
    }
    if (definitions === null) log(`issue fields unavailable for ${owner}`);
    issueFieldCache.set(owner, definitions);
    return definitions;
  }

  async function readIssueFieldValues(issueId) {
    const data = await gh.graphql(ISSUE_FIELD_VALUES_QUERY, { id: issueId });
    const nodes = data?.node?.issueFieldValues?.nodes ?? [];
    return new Map(nodes.filter((node) => node.field?.name).map((node) => [node.field.name, String(node.value)]));
  }

  async function ensureIssueFields(issueId, owner, fields) {
    const names = Object.keys(fields);
    const definitions = await issueFieldDefinitions(owner);
    if (definitions === null) return { unavailable: true };
    const wanted = names.map((name) => {
      const definition = definitions.get(name);
      if (!definition) throw new GdmError(`field ${name}: not defined for ${owner}`);
      return definition;
    });
    const current = await readIssueFieldValues(issueId);
    const stale = wanted.filter((definition) => current.get(definition.name) !== String(fields[definition.name]));
    if (stale.length === 0) return { unavailable: false, written: 0 };
    await pace();
    const issueFields = stale.map((definition) => issueFieldInput(definition, fields[definition.name]));
    await gh.graphql(SET_ISSUE_FIELDS_MUTATION, { input: { issueId, issueFields } });
    const after = await readIssueFieldValues(issueId);
    for (const definition of wanted) {
      if (after.get(definition.name) !== String(fields[definition.name])) {
        throw new GdmError(`field ${definition.name}: wrote "${fields[definition.name]}" but read back "${after.get(definition.name) ?? "nothing"}"`);
      }
    }
    return { unavailable: false, written: stale.length };
  }

  async function projectInfo(projectUrl) {
    if (projectCache.has(projectUrl)) return projectCache.get(projectUrl);
    const parsed = parseProjectUrl(projectUrl);
    const data = await gh.graphql(projectFieldsQuery(parsed.scope), { login: parsed.login, number: parsed.number });
    const project = data?.[parsed.scope]?.projectV2;
    if (!project) throw new GdmError(`project not found: ${projectUrl}`);
    const fields = new Map(project.fields.nodes.filter((node) => node.name).map((node) => [node.name, node]));
    const info = { id: project.id, fields };
    projectCache.set(projectUrl, info);
    return info;
  }

  async function syncProject(projectUrl, issueId, projectFields) {
    const project = await projectInfo(projectUrl);
    const definitions = Object.keys(projectFields).map((name) => {
      const definition = project.fields.get(name);
      if (!definition) throw new GdmError(`project field ${name}: not found in ${projectUrl}`);
      return definition;
    });
    await pace();
    const added = await gh.graphql(ADD_PROJECT_ITEM_MUTATION, { projectId: project.id, contentId: issueId });
    const itemId = added?.addProjectV2ItemById?.item?.id;
    if (!itemId) throw new GdmError(`could not add the issue to ${projectUrl}`);
    for (const definition of definitions) {
      await pace();
      const value = projectFieldValue(definition, projectFields[definition.name]);
      await gh.graphql(UPDATE_PROJECT_FIELD_MUTATION, { input: { projectId: project.id, itemId, fieldId: definition.id, value } });
    }
  }

  return { ensureIssueFields, syncProject };
}
