import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const PLUGIN_NAME = "github-dev-methodology";
export const PLUGIN_SOURCE = "./plugins/github-dev-methodology";
const MARKETPLACE = join(".claude-plugin", "marketplace.json");

export function findReleaseRoot(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, MARKETPLACE))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function createReleaseContext(root) {
  const plugin = join(root, "plugins", PLUGIN_NAME);
  const skill = join(plugin, "skills", PLUGIN_NAME);
  const failures = [];
  const show = (path) => relative(root, path) || ".";

  const context = {
    root,
    plugin,
    skill,
    references: join(skill, "references"),
    assets: join(skill, "assets"),
    commands: join(skill, "scripts", "commands"),
    failures,
    show,
    fail: (check, detail) => failures.push({ check, detail }),
    text(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        context.fail("files", `cannot read ${show(path)}: ${error.code ?? error.message}`);
        return null;
      }
    },
    json(path) {
      const raw = context.text(path);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        context.fail("files", `${show(path)} is not valid JSON: ${error.message}`);
        return null;
      }
    },
    referenceFiles() {
      if (!existsSync(context.references)) return [];
      return readdirSync(context.references)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => join(context.references, name));
    },
    docFiles() {
      return [join(skill, "SKILL.md"), ...context.referenceFiles(), join(root, "README.md"), join(root, "AGENTS.md")];
    },
  };
  return context;
}
