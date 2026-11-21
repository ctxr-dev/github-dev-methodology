---
alwaysApply: true
description: GitHub workflow methodology for repos that contain .github-dev-methodology/config.json
---

# github-dev-methodology

- This rule applies only when the repo root has `.github-dev-methodology/config.json`. Otherwise ignore it.
- Before any branch, issue, PR or merge work, read the `github-dev-methodology` skill.
- The `gdm` CLI is `node <skill-dir>/scripts/gdm.mjs`, where `<skill-dir>` is the `github-dev-methodology` skill directory.
- Run `gdm doctor` once per session.
- Never commit on the default branch. Work in a worktree made by `gdm worktrees add`.
- Never merge, enable auto-merge or queue a PR unless `gdm pr can-merge <pr>` exits 0.
