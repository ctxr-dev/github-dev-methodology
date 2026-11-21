This repository follows github-dev-methodology. Settings: {{CONFIG_PATH}}.

Active features: {{ACTIVE_FEATURES}}.

Before any branch, issue, PR, review or merge work:

1. Read {{SKILL_DIR}}/SKILL.md.
2. Run `node {{SKILL_DIR}}/scripts/gdm.mjs doctor` once in this session and fix every error it reports.
3. Read only the reference files that `node {{SKILL_DIR}}/scripts/gdm.mjs config features --json` lists as active.

Choose the lane first:

- Lane 0: a bot dependency PR, or a docs or typo change with no behaviour change. Worktree, PR, watch CI, merge as the merge authority allows. No issue.
- Lane 1: one defect or one feature. Issue, claim it, worktree, PR with `Closes owner/repo#N`, full PR loop.
- Lane 2: several independent deliverables or cross-repo work. Plan, `plan sync`, then each child as Lane 1.

Never commit on the default branch. Never merge, enable auto-merge or add a PR to a merge queue unless `node {{SKILL_DIR}}/scripts/gdm.mjs pr can-merge <pr>` exits 0.
