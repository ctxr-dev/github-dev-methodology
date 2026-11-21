import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { PLUGIN_NAME, PLUGIN_SOURCE } from "./release-context.mjs";

function skillVersion(r) {
  const text = r.text(join(r.skill, "SKILL.md"));
  if (text === null) return undefined;
  try {
    return parseFrontmatter(text).data.metadata?.version;
  } catch (error) {
    r.fail("version", `SKILL.md frontmatter is invalid: ${error.message}`);
    return undefined;
  }
}

const jsonSource = (r, path) => [r.show(path), r.json(path)?.version];

function versionSources(r) {
  return [
    jsonSource(r, join(r.root, "package.json")),
    jsonSource(r, join(r.plugin, "package.json")),
    jsonSource(r, join(r.plugin, ".claude-plugin", "plugin.json")),
    jsonSource(r, join(r.plugin, ".codex-plugin", "plugin.json")),
    [`${r.show(join(r.skill, "SKILL.md"))} metadata.version`, skillVersion(r)],
  ];
}

export function checkVersionInvariant(r) {
  const sources = versionSources(r);
  const [baseName, baseVersion] = sources[0];
  if (typeof baseVersion !== "string") return r.fail("version", `${baseName} has no version string`);
  for (const [name, version] of sources.slice(1)) {
    if (version !== baseVersion) {
      r.fail("version", `${name} is ${JSON.stringify(version)} but ${baseName} is ${JSON.stringify(baseVersion)}`);
    }
  }
}

function versionKeyPaths(value, path = "") {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path === "" ? key : `${path}.${key}`;
    return [...(key === "version" ? [childPath] : []), ...versionKeyPaths(child, childPath)];
  });
}

function checkPluginEntry(r, file, entries, sourceOf) {
  const entry = (Array.isArray(entries) ? entries : []).find((candidate) => candidate?.name === PLUGIN_NAME);
  if (!entry) return r.fail("marketplace", `${file} has no plugin named ${PLUGIN_NAME}`);
  if (sourceOf(entry) !== PLUGIN_SOURCE) {
    r.fail("marketplace", `${file} plugin ${PLUGIN_NAME} has source ${JSON.stringify(sourceOf(entry))}, expected ${PLUGIN_SOURCE}`);
  }
}

export function checkMarketplaces(r) {
  const claudeFile = ".claude-plugin/marketplace.json";
  const codexFile = ".agents/plugins/marketplace.json";
  const claude = r.json(join(r.root, claudeFile));
  const codex = r.json(join(r.root, codexFile));
  for (const [file, data] of [[claudeFile, claude], [codexFile, codex]]) {
    for (const path of versionKeyPaths(data)) r.fail("marketplace-version", `${file} must not contain a version key (found ${path})`);
  }
  if (claude) checkPluginEntry(r, claudeFile, claude.plugins, (entry) => entry.source);
  if (codex) checkPluginEntry(r, codexFile, codex.plugins, (entry) => entry.source?.path);
}
