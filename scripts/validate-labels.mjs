#!/usr/bin/env node
// validate-labels.mjs <OWNER> [--repos repo1,repo2] [--project <slug>] [--fix]
//
// Walks the canonical label set from templates/labels/default-taxonomy.yaml.
// For each repo, verifies every locked label exists with the right color.
// `--fix` cascade-installs missing/drifted labels via gh label create --force.
// `--project <slug>` overrides the active project in the local config.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "yaml";

import { ghJson } from "./lib/gh.mjs";
import { readLocalConfig } from "./lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER = process.argv[2];
if (!OWNER) {
  console.error("Usage: validate-labels.mjs <owner> [--repos repo1,repo2] [--project <slug>] [--fix]");
  process.exit(1);
}
const fix = process.argv.includes("--fix");
const reposArgIdx = process.argv.indexOf("--repos");
const projectArgIdx = process.argv.indexOf("--project");
const projectSlug = projectArgIdx >= 0 ? process.argv[projectArgIdx + 1] : null;
let repos;
if (reposArgIdx >= 0) {
  repos = process.argv[reposArgIdx + 1].split(",").map((s) => s.trim());
} else {
  // Read from local config: primary_repo + sibling_repos for the active (or selected) project.
  const cfg = readLocalConfig({ project: projectSlug });
  repos = [cfg.primary_repo, ...(cfg.sibling_repos ?? "").split(",").map((s) => s.trim())].filter(Boolean);
}
if (!repos.length) {
  console.error("No repos configured. Pass --repos repo1,repo2 OR populate primary_repo / sibling_repos under a `## Project: <slug>` section in github-dev-methodology.config.local.md (and point `active_project` at it).");
  process.exit(1);
}

const taxonomyPath = join(__dirname, "..", "templates", "labels", "default-taxonomy.yaml");
const taxonomy = yaml.parse(readFileSync(taxonomyPath, "utf8"));

const drifts = [];
for (const repo of repos) {
  console.log(`\n=== ${OWNER}/${repo} ===`);
  const existing = ghJson(["label", "list", "--repo", `${OWNER}/${repo}`, "--limit", "100", "--json", "name,color,description"]);
  const byName = new Map(existing.map((l) => [l.name, l]));
  for (const want of taxonomy.locked) {
    const got = byName.get(want.name);
    if (!got) {
      drifts.push({ repo, name: want.name, kind: "missing", expected: want });
      console.log(`  MISSING ${want.name}`);
      if (fix) {
        spawnSync("gh", ["label", "create", want.name, "--repo", `${OWNER}/${repo}`, "--description", want.description, "--color", want.color, "--force"], { stdio: "inherit" });
      }
    } else if ((got.color ?? "").toUpperCase() !== want.color.toUpperCase() || (got.description ?? "") !== want.description) {
      drifts.push({ repo, name: want.name, kind: "drift", expected: want, got });
      console.log(`  DRIFT ${want.name} (color=${got.color} desc=${got.description?.slice(0, 40)}...)`);
      if (fix) {
        spawnSync("gh", ["label", "edit", want.name, "--repo", `${OWNER}/${repo}`, "--description", want.description, "--color", want.color], { stdio: "inherit" });
      }
    } else {
      console.log(`  OK ${want.name}`);
    }
  }
}

console.log(`\n=== Summary ===`);
console.log(`  repos:    ${repos.length}`);
console.log(`  labels per repo (locked): ${taxonomy.locked.length}`);
console.log(`  drifts:   ${drifts.length}`);
if (drifts.length && !fix) {
  console.log("\nRun with --fix to cascade-install canonical taxonomy.");
  process.exit(1);
}
console.log(fix ? "Drifts repaired." : "All locked labels present + canonical.");
