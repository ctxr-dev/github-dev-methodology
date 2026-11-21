import { readFileSync, writeFileSync } from "node:fs";
import { GhError } from "./errors.mjs";
import { COPILOT_LOGIN, canonicalReviewer, isBotLogin, normalizeLogin } from "./logins.mjs";
import {
  REQUEST_REVIEWS_MUTATION,
  REVIEW_REQUESTS_QUERY,
  SUGGESTED_REVIEWERS_QUERY,
  userIdsQuery,
} from "./pr-queries.mjs";

function requestedLogins(pullRequest) {
  return pullRequest.reviewRequests.nodes
    .map((node) => node.requestedReviewer?.login ?? node.requestedReviewer?.slug)
    .filter(Boolean);
}

export async function readPullRequest(gh, ref) {
  const data = await gh.graphql(REVIEW_REQUESTS_QUERY, { o: ref.owner, r: ref.repo, n: ref.number });
  const pullRequest = data?.repository?.pullRequest;
  if (!pullRequest) throw new GhError(`PR not found: ${ref.owner}/${ref.repo}#${ref.number}`);
  return { id: pullRequest.id, requested: requestedLogins(pullRequest) };
}

async function resolveUserIds(gh, logins) {
  if (logins.length === 0) return new Map();
  const variables = Object.fromEntries(logins.map((login, index) => [`l${index}`, login]));
  const data = await gh.graphql(userIdsQuery(logins.length), variables);
  const ids = new Map();
  logins.forEach((login, index) => {
    const user = data[`u${index}`];
    if (user?.id) ids.set(normalizeLogin(login), user.id);
  });
  return ids;
}

async function discoverBotIds(gh, ref) {
  const data = await gh.graphql(SUGGESTED_REVIEWERS_QUERY, { o: ref.owner, r: ref.repo });
  const ids = new Map();
  for (const actor of data?.repository?.suggestedActors?.nodes ?? []) {
    if (actor?.id && actor.login) ids.set(normalizeLogin(actor.login), actor.id);
  }
  return ids;
}

export function persistCopilotBotId(configPath, projectSlug, botId) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const project = config.projects[projectSlug];
  project.cache = { ...(project.cache ?? {}), copilot_bot_id: botId };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function resolveBotIds(gh, ref, bots, loaded) {
  const ids = new Map();
  const cachedCopilot = loaded.project.cache?.copilot_bot_id;
  const pending = [];
  for (const login of bots) {
    if (normalizeLogin(login) === COPILOT_LOGIN && cachedCopilot) ids.set(COPILOT_LOGIN, cachedCopilot);
    else pending.push(login);
  }
  if (pending.length === 0) return ids;
  const discovered = await discoverBotIds(gh, ref);
  for (const login of pending) {
    const id = discovered.get(normalizeLogin(login));
    if (id) ids.set(normalizeLogin(login), id);
  }
  if (!cachedCopilot && ids.has(COPILOT_LOGIN)) persistCopilotBotId(loaded.path, loaded.projectSlug, ids.get(COPILOT_LOGIN));
  return ids;
}

export async function requestConfiguredReviews(gh, ref, loaded) {
  const configured = loaded.project.review.reviewers.map(canonicalReviewer);
  if (configured.length === 0) return { configured, ignored: [] };
  const users = configured.filter((login) => !isBotLogin(login));
  const bots = configured.filter(isBotLogin);
  const pullRequest = await readPullRequest(gh, ref);
  const userIds = await resolveUserIds(gh, users);
  const botIds = await resolveBotIds(gh, ref, bots, loaded);
  const requestIds = { userIds: [...userIds.values()], botIds: [...botIds.values()] };
  if (requestIds.userIds.length + requestIds.botIds.length > 0) {
    await gh.graphql(REQUEST_REVIEWS_MUTATION, { pr: pullRequest.id, ...requestIds });
  }
  const after = new Set((await readPullRequest(gh, ref)).requested.map(normalizeLogin));
  return { configured, ignored: configured.filter((login) => !after.has(normalizeLogin(login))) };
}
