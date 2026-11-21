import { join } from "node:path";
import { DEPENDENCIES, FEATURE_DOCS, FLAGS, PRESETS } from "./features.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";
import { validateRepoConfig } from "./schema-check.mjs";

const BOGUS_FLAG = "gdm_release_probe_flag";
const sorted = (values) => [...values].sort();

function compareSets(r, check, name, actual) {
  const missing = FLAGS.filter((flag) => !actual.includes(flag));
  const extra = actual.filter((flag) => !FLAGS.includes(flag));
  if (missing.length > 0) r.fail(check, `${name} lacks flag(s): ${missing.join(", ")}`);
  if (extra.length > 0) r.fail(check, `${name} has unknown flag(s): ${extra.join(", ")}`);
}

function withFeatures(template, features) {
  const copy = structuredClone(template);
  const slug = Object.keys(copy.projects)[0];
  copy.projects[slug].features = features;
  return copy;
}

export function checkSchemaAndTemplate(r) {
  const schema = r.json(join(r.assets, "config.schema.json"));
  const template = r.json(join(r.assets, "config.template.json"));
  const project = schema?.$defs?.project?.properties;
  if (schema) {
    compareSets(r, "flags-schema", "assets/config.schema.json features", Object.keys(project?.features?.properties ?? {}));
    const presets = project?.preset?.enum ?? [];
    if (sorted(presets).join() !== sorted(Object.keys(PRESETS)).join()) {
      r.fail("flags-schema", `assets/config.schema.json preset enum is [${presets.join(", ")}], expected [${Object.keys(PRESETS).join(", ")}]`);
    }
  }
  if (template) checkTemplate(r, template);
}

function checkTemplate(r, template) {
  for (const error of validateRepoConfig(template)) r.fail("template", `assets/config.template.json: ${error}`);
  const slug = Object.keys(template.projects ?? {})[0];
  const present = Object.keys(template.projects?.[slug]?.features ?? {});
  const unknown = present.filter((flag) => !FLAGS.includes(flag));
  if (unknown.length > 0) r.fail("flags-template", `assets/config.template.json features has unknown flag(s): ${unknown.join(", ")}`);
  if (!slug) return;
  const everyFlag = Object.fromEntries(FLAGS.map((flag) => [flag, true]));
  for (const error of validateRepoConfig(withFeatures(template, everyFlag))) {
    r.fail("flags-template", `a config with every flag set is rejected: ${error}`);
  }
  if (validateRepoConfig(withFeatures(template, { [BOGUS_FLAG]: true })).length === 0) {
    r.fail("flags-template", "validateRepoConfig accepts an unknown feature flag");
  }
}

export function checkConfigurationTable(r) {
  const text = r.text(join(r.references, "configuration.md"));
  if (text === null) return;
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => /^\|\s*Flag\s*\|/.test(line));
  if (header === -1) return r.fail("flags-docs", "references/configuration.md has no flag table (header `| Flag |`)");
  const flags = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cell = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (cell) flags.push(cell[1]);
  }
  compareSets(r, "flags-docs", "references/configuration.md flag table", flags);
}

function expectedRequires(feature) {
  return Object.hasOwn(DEPENDENCIES, feature) ? [DEPENDENCIES[feature]] : [];
}

function checkReference(r, file) {
  const name = `references/${file.split("/").pop()}`;
  const text = r.text(file);
  if (text === null) return null;
  let data;
  try {
    data = parseFrontmatter(text).data;
  } catch (error) {
    r.fail("references", `${name} frontmatter is invalid: ${error.message}`);
    return null;
  }
  if (data.feature === undefined) return null;
  if (!FLAGS.includes(data.feature)) {
    r.fail("references", `${name} has unknown feature "${data.feature}"`);
    return null;
  }
  const requires = data.requires?.features ?? [];
  const expected = expectedRequires(data.feature);
  if (requires.join() !== expected.join()) {
    r.fail("references", `${name} requires.features is [${requires.join(", ")}], expected [${expected.join(", ")}]`);
  }
  return data.feature;
}

export function checkReferences(r) {
  const featureByFile = new Map();
  for (const file of r.referenceFiles()) featureByFile.set(file.split("/").pop(), checkReference(r, file));
  for (const [flag, doc] of Object.entries(FEATURE_DOCS)) {
    if (!featureByFile.has(doc)) r.fail("references", `references/${doc} for flag ${flag} does not exist`);
    else if (featureByFile.get(doc) !== flag) r.fail("references", `references/${doc} must declare feature: ${flag}`);
  }
}
