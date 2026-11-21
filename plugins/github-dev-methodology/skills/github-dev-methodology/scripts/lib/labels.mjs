import { readFileSync } from "node:fs";
import { GhError } from "./errors.mjs";
import { assetPath } from "./skill-dir.mjs";

const normalizeColor = (color) => (color ?? "").replace(/^#/, "").toUpperCase();

export function loadLockedLabels() {
  return JSON.parse(readFileSync(assetPath("labels.json"), "utf8")).locked;
}

export async function listRepoLabels(gh, slug) {
  const args = ["label", "list", "--repo", slug, "--limit", "1000", "--json", "name,color,description"];
  const result = await gh.cli(args);
  if (result.status !== 0) {
    throw new GhError(`gh label list failed for ${slug}: ${(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(result.stdout || "[]");
}

export function classifyLabels(locked, existing) {
  const byName = new Map(existing.map((entry) => [entry.name, entry]));
  return locked.map((want) => {
    const got = byName.get(want.name);
    if (!got) return { want, status: "missing" };
    const same = normalizeColor(got.color) === normalizeColor(want.color) && (got.description ?? "") === want.description;
    return { want, got, status: same ? "ok" : "drift" };
  });
}

export function repairArgs(entry, slug) {
  const common = [entry.want.name, "--repo", slug, "--description", entry.want.description, "--color", entry.want.color];
  return entry.status === "missing" ? ["label", "create", ...common, "--force"] : ["label", "edit", ...common];
}
