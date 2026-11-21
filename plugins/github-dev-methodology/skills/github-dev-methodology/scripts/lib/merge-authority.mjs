import { normalizeLogin } from "./logins.mjs";

const EXIT_ALLOW = 0;
const EXIT_NOT_READY = 3;
const EXIT_NEEDS_HUMAN = 4;
const DEPENDENCY_BOT_AUTHORS = new Set(["dependabot", "renovate"]);

const allow = (reason) => ({ decision: "allow", reason, exitCode: EXIT_ALLOW });
const ask = (reason) => ({ decision: "ask", reason, exitCode: EXIT_NEEDS_HUMAN });
const deny = (reason, exitCode = EXIT_NEEDS_HUMAN) => ({ decision: "deny", reason, exitCode });

function decideScoped({ scopes, prAuthor }) {
  const isDependencyBot = DEPENDENCY_BOT_AUTHORS.has(normalizeLogin(prAuthor));
  if (scopes.includes("dependabot-green") && isDependencyBot) {
    return allow("merge.authority is scoped (dependabot-green): green PR from a dependency bot");
  }
  if (scopes.includes("session-instruction")) {
    return ask("needs explicit owner instruction in this session");
  }
  return deny("merge.authority is scoped and no scope covers this PR; the owner merges it");
}

export function decideMerge({ authority, scopes = [], predicateReady, prAuthor }) {
  if (authority === "human") {
    return deny("merge.authority is human: the owner merges this PR");
  }
  if (authority !== "scoped" && authority !== "autonomous") {
    return deny(`unknown merge.authority "${authority}": the owner merges this PR`);
  }
  if (!predicateReady) {
    return deny("PR is not ready: the review predicate is not satisfied", EXIT_NOT_READY);
  }
  if (authority === "autonomous") {
    return allow("merge.authority is autonomous and the PR is ready");
  }
  return decideScoped({ scopes, prAuthor });
}
