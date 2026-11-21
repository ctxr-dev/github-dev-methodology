import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const assetPath = (name) => join(SKILL_DIR, "assets", name);
