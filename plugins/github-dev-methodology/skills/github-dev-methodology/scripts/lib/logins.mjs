export const COPILOT_LOGIN = "copilot-pull-request-reviewer";

export function normalizeLogin(login) {
  let value = String(login ?? "").trim().toLowerCase();
  if (value.startsWith("app/")) value = value.slice("app/".length);
  if (value.endsWith("[bot]")) value = value.slice(0, -"[bot]".length);
  return value === "copilot" ? COPILOT_LOGIN : value;
}

export function sameLogin(left, right) {
  return normalizeLogin(left) === normalizeLogin(right);
}

export function canonicalReviewer(login) {
  const trimmed = String(login ?? "").trim();
  return trimmed.toLowerCase() === "copilot" ? COPILOT_LOGIN : trimmed;
}

export function isBotLogin(login) {
  const raw = String(login ?? "").trim().toLowerCase();
  return raw.endsWith("[bot]") || raw.startsWith("app/") || normalizeLogin(raw) === COPILOT_LOGIN;
}
