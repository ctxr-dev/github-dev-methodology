import { spawnSync } from "node:child_process";
import { GhError, GhMissingError, GhRateLimitError } from "./errors.mjs";

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const RATE_LIMIT_DELAY_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 3;

export function spawnSyncRunner(args, { input } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: MAX_BUFFER_BYTES, input });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimited({ stdout, stderr }) {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  if (text.includes("secondary rate limit")) return true;
  return text.includes("rate limit") && /\b(429|403)\b/.test(text);
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((node, key) => node?.[key], value);
}

function failureMessage(args, { stdout, stderr }) {
  const detail = (stderr || stdout).trim();
  return detail || `gh ${args.join(" ")} failed`;
}

export function createGh(runner = spawnSyncRunner, { sleep = defaultSleep } = {}) {
  async function invoke(args, input) {
    let result;
    try {
      result = await runner(args, { input });
    } catch (error) {
      if (error?.code === "ENOENT") throw new GhMissingError();
      throw error;
    }
    if (result.error?.code === "ENOENT") throw new GhMissingError();
    if (result.error) throw new GhError(result.error.message);
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  async function execute(args, input) {
    for (let attempt = 0; ; attempt += 1) {
      const result = await invoke(args, input);
      if (!isRateLimited(result)) return result;
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new GhRateLimitError(failureMessage(args, result), result);
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  async function executeOrThrow(args, input) {
    const result = await execute(args, input);
    if (result.status !== 0) throw new GhError(failureMessage(args, result), result);
    return result;
  }

  async function graphql(query, variables = {}) {
    const input = JSON.stringify({ query, variables });
    const { stdout } = await executeOrThrow(["api", "graphql", "--input", "-"], input);
    const payload = JSON.parse(stdout);
    if (payload.errors?.length) {
      const messages = payload.errors.map((error) => error.message);
      throw new GhError(messages.join("; "), { errors: payload.errors });
    }
    return payload.data;
  }

  async function graphqlPaginated(query, variables, connectionPath) {
    const nodes = [];
    let cursor = null;
    for (;;) {
      const data = await graphql(query, { ...variables, cursor });
      const connection = readPath(data, connectionPath);
      if (!connection) return nodes;
      nodes.push(...(connection.nodes ?? []));
      const { hasNextPage, endCursor } = connection.pageInfo ?? {};
      if (!hasNextPage) return nodes;
      if (!endCursor) throw new GhError(`${connectionPath} reports another page without an endCursor`);
      cursor = endCursor;
    }
  }

  async function rest(method, path, body) {
    const args = ["api", "-X", method, path];
    const hasBody = body !== undefined;
    if (hasBody) args.push("--input", "-");
    const { stdout } = await executeOrThrow(args, hasBody ? JSON.stringify(body) : undefined);
    return stdout.trim() === "" ? null : JSON.parse(stdout);
  }

  async function cli(args, { input } = {}) {
    return execute(args, input);
  }

  return { graphql, graphqlPaginated, rest, cli };
}
