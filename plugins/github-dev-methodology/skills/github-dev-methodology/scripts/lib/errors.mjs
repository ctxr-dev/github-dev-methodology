export class GdmError extends Error {
  exitCode = 1;

  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export class UsageError extends GdmError {
  exitCode = 64;
}

export class GhMissingError extends GdmError {
  constructor() {
    super("gh CLI not found on PATH; install it from https://cli.github.com and run: gh auth login");
  }
}

export class GhError extends GdmError {
  constructor(message, { status = 1, stderr = "", errors = [] } = {}) {
    super(message);
    this.status = status;
    this.stderr = stderr;
    this.errors = errors;
    this.httpStatus = parseHttpStatus(`${message}\n${stderr}`);
  }
}

export class GhRateLimitError extends GhError {}

export class NotGitRepoError extends GdmError {}

export class NoOriginError extends GdmError {
  constructor(message = "worktree and state commands need an origin remote") {
    super(message);
  }
}

export class UnsupportedRemoteError extends NoOriginError {}

export class ConfigMissingError extends GdmError {
  constructor() {
    super("no .github-dev-methodology/config.json found; run: gdm init");
  }
}

export class ProjectMissingError extends GdmError {}

export class ConfigInvalidError extends GdmError {
  constructor(source, errors) {
    super(`${source} is invalid:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    this.source = source;
    this.errors = errors;
  }
}

function parseHttpStatus(text) {
  const match = /\bHTTP (\d{3})\b/.exec(text);
  return match ? Number(match[1]) : null;
}
