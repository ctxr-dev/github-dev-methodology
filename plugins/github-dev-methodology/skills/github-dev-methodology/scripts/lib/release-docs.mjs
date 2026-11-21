import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FLAGS } from "./features.mjs";
import { codeSegments, linkTargets } from "./markdown-scan.mjs";

const SKILL_LINE_LIMIT = 500;
const SESSION_CONTEXT_LIMIT = 8000;
const EXTERNAL_TARGET = /^([a-z][a-z0-9+.-]*:|#|<)/i;
const GDM_MENTION = /(?<![\w@-])gdm(?:\.mjs)? ([a-z][a-z0-9-]*)(?: ([a-z][a-z0-9-]*))?/g;

export function checkSkillLength(r) {
  const text = r.text(join(r.skill, "SKILL.md"));
  if (text === null) return;
  const lines = text.trimEnd().split("\n").length;
  if (lines >= SKILL_LINE_LIMIT) r.fail("skill-length", `SKILL.md has ${lines} lines, the limit is ${SKILL_LINE_LIMIT - 1}`);
}

export function checkSessionContext(r) {
  const template = r.text(join(r.assets, "session-context.md"));
  if (template === null) return;
  const values = {
    "{{SKILL_DIR}}": r.skill,
    "{{ACTIVE_FEATURES}}": FLAGS.join(", "),
    "{{CONFIG_PATH}}": join(r.root, ".github-dev-methodology", "config.json"),
  };
  const rendered = Object.entries(values).reduce((text, [token, value]) => text.replaceAll(token, value), template.trimEnd());
  const leftover = rendered.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) r.fail("session-context", `unreplaced placeholder(s): ${[...new Set(leftover)].join(", ")}`);
  if (rendered.length > SESSION_CONTEXT_LIMIT) {
    r.fail("session-context", `rendered context is ${rendered.length} characters with all ${FLAGS.length} flags on, the limit is ${SESSION_CONTEXT_LIMIT}`);
  }
}

export function checkLinks(r) {
  for (const file of r.docFiles()) {
    const text = existsSync(file) ? r.text(file) : (r.fail("links", `${r.show(file)} does not exist`), null);
    if (text === null) continue;
    for (const target of linkTargets(text)) {
      if (EXTERNAL_TARGET.test(target)) continue;
      const path = decodeURI(target.split(/[#?]/)[0]);
      if (path !== "" && !existsSync(resolve(dirname(file), path))) {
        r.fail("links", `${r.show(file)} links to ${target}, which does not exist`);
      }
    }
  }
}

function commandExists(commandNames, [group, command]) {
  if (command && commandNames.has(`${group}-${command}`)) return true;
  if (commandNames.has(group)) return true;
  return !command && [...commandNames].some((name) => name.startsWith(`${group}-`));
}

export function checkCommandMentions(r) {
  const commandNames = new Set(
    existsSync(r.commands) ? readdirSync(r.commands).filter((name) => name.endsWith(".mjs")).map((name) => name.slice(0, -4)) : [],
  );
  for (const file of r.docFiles()) {
    const text = existsSync(file) ? r.text(file) : null;
    if (text === null) continue;
    const reported = new Set();
    for (const segment of codeSegments(text)) {
      for (const [, group, command] of segment.matchAll(GDM_MENTION)) {
        const mention = command ? `gdm ${group} ${command}` : `gdm ${group}`;
        if (reported.has(mention) || commandExists(commandNames, [group, command])) continue;
        reported.add(mention);
        r.fail("commands", `${r.show(file)} mentions "${mention}" but no command module matches it`);
      }
    }
  }
}
