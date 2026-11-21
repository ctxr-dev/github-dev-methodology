import { readFileSync } from "node:fs";

const ASSETS_DIR = new URL("../../assets/", import.meta.url);

export function readAsset(name) {
  return readFileSync(new URL(name, ASSETS_DIR), "utf8");
}

export function readAssetJson(name) {
  return JSON.parse(readAsset(name));
}
