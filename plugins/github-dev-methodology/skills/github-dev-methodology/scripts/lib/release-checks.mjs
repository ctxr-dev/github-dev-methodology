import { checkCommandMentions, checkLinks, checkSessionContext, checkSkillLength } from "./release-docs.mjs";
import { createReleaseContext } from "./release-context.mjs";
import { checkConfigurationTable, checkReferences, checkSchemaAndTemplate } from "./release-flags.mjs";
import { checkMarketplaces, checkVersionInvariant } from "./release-versions.mjs";

const CHECKS = [
  checkVersionInvariant,
  checkMarketplaces,
  checkSchemaAndTemplate,
  checkConfigurationTable,
  checkReferences,
  checkSkillLength,
  checkSessionContext,
  checkLinks,
  checkCommandMentions,
];

export function runReleaseChecks(root) {
  const context = createReleaseContext(root);
  for (const check of CHECKS) check(context);
  return context.failures;
}
