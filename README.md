<div align="center">

# Github Dev Methodology

### A portable, agent-agnostic methodology for AI-driven engineering work
##### One contract for every AI: shared issue shape, PR loop, plan-to-issues migration, validators.

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
  <a href="https://agents.md"><img alt="Convention: .agents/" src="https://img.shields.io/badge/convention-.agents%2F-7c3aed?style=for-the-badge"></a>
  <img alt="Node ≥ 20" src="https://img.shields.io/badge/node-%E2%89%A5%2020-43853d?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="Source of truth: GitHub Issues + Projects" src="https://img.shields.io/badge/source%20of%20truth-GitHub%20Issues%20%2B%20Projects-181717?style=for-the-badge&logo=github">
</p>

<p>
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-✓-D97757?style=flat-square">
  <img alt="Codex CLI" src="https://img.shields.io/badge/Codex%20CLI-✓-000000?style=flat-square">
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-✓-1e1e1e?style=flat-square">
  <img alt="Aider" src="https://img.shields.io/badge/Aider-✓-5a2a82?style=flat-square">
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/Copilot-✓-2ea44f?style=flat-square">
  <img alt="Continue · Cline · Zed · Warp" src="https://img.shields.io/badge/Continue%20·%20Cline%20·%20Zed%20·%20Warp-✓-6b7280?style=flat-square">
</p>

<p>
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#whats-inside"><strong>What's inside</strong></a> ·
  <a href="#per-project-configuration"><strong>Configuration</strong></a> ·
  <a href="#agent-compatibility"><strong>Compatibility</strong></a> ·
  <a href="#layout"><strong>Layout</strong></a>
</p>

</div>

<br/>

> AI coding agents drift. Different sessions, different agents, and humans on the same team all need **one durable contract** for how work is shaped: how issues are written, how PRs converge to merge, how plans become tracked work. This repo bundles that contract - plus the validators that enforce it - in a form **any agent** can read.

---

## What's inside

| Capability | What it does |
|---|---|
| 🔁 **PR review loop** | Watches a SET of reviewers (Copilot + individual humans; a team is requested for review but tracked via its member logins). Explicit exit predicate (every configured reviewer re-reviewed HEAD and green · no unresolved non-outdated thread by them · required approvals · CI green). Foreground watch, 60s default cadence, 24h max. |
| 📋 **Plan → Issues** | Turn a markdown plan into a wired native sub-issue tree on a GitHub Project. Every issue cold-start ready. |
| 🎯 **Issue lifecycle** | Single-issue / single-PR flow. Agent owns `In progress` and `In review`; human owns `Done`, merge, close. |
| 📐 **Canonical issue schema** | Metadata header + Why + Action items + Acceptance + Implementation pointers + Test plan. Validator hard-fails on missing sections. |
| 🏷️ **Locked label taxonomy** | `type:*` / `scope:*` / `phase:*` / `release:*` (cross-repo locked) + `area:*` (project-extensible). |
| ✅ **4 Node validators** | Parent-chain walk · issue-schema check · cross-repo label consistency · plan-vs-issues diff. |
| 🧭 **Agents orchestration** | Default pattern for non-trivial work: push focused work into fresh subagents; orchestrator holds only plan + decisions + compacted history. |
| 🔍 **Parallel validation** | After every plan migration, 3 audit agents (completeness / dep-graph / cold-start) scoped to TOUCHED issues only. |
| 🗂️ **Plan deprecation** | Once issues exist, the original plan file is auto-minimized to title + 1-paragraph + epic link. |
| 🎚️ **Opt-in features** | 3-tier preset (`pr-only` / `single-issue` / `full`) picked at install time. 13 individual flags you can flip later. No project board? Pick `pr-only` and the agent never touches issues, labels, or boards. |

---

## Install

Works with any agent that can run shell and edit files. **Copy this prompt and paste it to your AI.**

> [!IMPORTANT]
> **Install the `github-dev-methodology` into this project.** Every step is idempotent - re-running is safe. **Run all commands from the project root** (the directory you want the methodology installed into).
>
> 1. **Clone the methodology under `.agents/`.** Create `.agents/` if missing.
>    ```sh
>    mkdir -p .agents/ctxr-dev
>    if [ ! -d .agents/ctxr-dev/github-dev-methodology/.git ]; then
>      git clone https://github.com/ctxr-dev/github-dev-methodology.git \
>        .agents/ctxr-dev/github-dev-methodology
>    fi
>    ```
>
> 2. **Update `.gitignore` (idempotent).** Run this exact shell block - it creates `.gitignore` if absent, ensures a trailing newline, and appends only patterns that are not already there:
>    ```sh
>    touch .gitignore
>    [ -n "$(tail -c1 .gitignore 2>/dev/null)" ] && printf '\n' >> .gitignore
>    for line in ".agents/ctxr-dev/github-dev-methodology" "*.local.md"; do
>      grep -qxF "$line" .gitignore || printf '%s\n' "$line" >> .gitignore
>    done
>    ```
>
> 3. **Wire `AGENTS.md` at the project root.** Identity key: the URL `.agents/ctxr-dev/github-dev-methodology/index.md` (use this to detect existing entries; never duplicate).
>    - If `AGENTS.md` does **not** exist, create it with this exact body:
>      ```markdown
>      # AGENTS.md
>
>      Entry point for AI coding agents working in this project.
>
>      ## Methodologies
>
>      - [ctxr-dev/github-dev-methodology](.agents/ctxr-dev/github-dev-methodology/index.md) - GitHub Issues + Projects workflow, PR loop, plan-to-issues, validation. **ALWAYS read first.**
>      ```
>    - If `AGENTS.md` exists and already contains the identity-key URL, do nothing.
>    - If `AGENTS.md` exists without the identity-key URL: ensure a `## Methodologies` section exists (append it with a leading blank line if not), then append the bullet above to that section.
>
> 4. **Claude Code accommodation.** Claude Code does not natively read `AGENTS.md`; it needs an `@AGENTS.md` import line in `CLAUDE.md`.
>    - If `CLAUDE.md` exists at the project root: ensure a line containing exactly `@AGENTS.md` is present (match the whole line, ignoring surrounding whitespace). Append it on its own line if missing.
>    - Else if `.claude/` directory exists at the project root: create `CLAUDE.md` with a single-line body `@AGENTS.md`.
>    - Else: ask the user once: *"Are you using Claude Code for this project? (y/n)"*. On yes, create the same one-line `CLAUDE.md`. On no, skip.
>
> 5. **Create the per-project config from the template (only if missing):**
>    ```sh
>    if [ ! -f .agents/ctxr-dev/github-dev-methodology.config.local.md ]; then
>      cp .agents/ctxr-dev/github-dev-methodology/templates/config.local.md \
>         .agents/ctxr-dev/github-dev-methodology.config.local.md
>    fi
>    ```
>
> 5b. **Install and register the `mcp-github` MCP server (recommended).** The methodology drives GitHub through the [`mcp-github`](https://github.com/ctxr-dev/mcp-github) MCP server (issue, PR, project, label, org, and workflow tools; see its README for the catalogue). The canonical install is the npx-from-GitHub entry below: npx fetches, builds, and runs the server on demand, so registering this entry **is** installing it. Add it to `./.mcp.json` (and `./.agents/mcp.json` if you keep a vendor-neutral copy), then restart your MCP client.
>
>    > [!IMPORTANT]
>    > **Every path you write into these MCP-config files MUST be relative to the project root**, never absolute. These files are checked into the project and shared across machines and CI; an absolute path like `/Users/alice/...` silently breaks on every other machine and inside CI containers. The recommended npx entry carries no path at all, which sidesteps this; the relative-path rule matters for the clone-and-build alternative below.
>
>    Minimal `mcpServers.github` entry. Merge it into the existing `mcpServers` map; do not overwrite other servers:
>    ```json
>    {
>      "mcpServers": {
>        "github": {
>          "command": "npx",
>          "args": ["-y", "github:ctxr-dev/mcp-github"],
>          "env": {
>            "GITHUB_TOKEN": "${GITHUB_TOKEN}",
>            "MCP_GITHUB_DENY_TOOLS": "gh.pr_merge"
>          }
>        }
>      }
>    }
>    ```
>
>    Notes:
>    - `GITHUB_TOKEN` is read from the launching shell. Required scopes per the active feature preset: see the scopes table in `index.md` (union of `repo,workflow,project,read:org`; add `admin:org` only if you opt into native Issue Type auto-create).
>    - `MCP_GITHUB_DENY_TOOLS=gh.pr_merge` keeps the agent off the merge gate at the server level (defence in depth; `pr-loop.md` and `audit-vs-execute.md` already forbid it at the methodology level).
>    - **First start builds the server.** The first time your MCP client launches this entry, npx fetches `mcp-github` from GitHub and builds it (needs network plus a Node build toolchain, takes tens of seconds); later starts use the npx cache. If your client's startup times out on that first build, use the clone-and-build alternative below.
>    - **Pin for reproducibility (recommended).** The entry above tracks the default branch, so different machines (or the same machine after a cache refresh) can run different server revisions. For a reproducible, trusted install, pin the ref to a tag or commit, for example `github:ctxr-dev/mcp-github#<tag-or-sha>`, and roll it forward when you choose. The ref must include the build hook that produces `dist/` (mcp-github PR #42 or later); an older ref installs without a built server.
>    - After editing the config, restart your MCP client (Claude Code, Cursor, and so on) so the new server is picked up, then confirm it is live by asking the agent to call `gh.test_connection`.
>
>    Skip this step if you already have a different GitHub MCP server registered in the project's `mcpServers` map.
>
>    <details>
>    <summary>Alternative install methods</summary>
>
>    - **From npm (once published):** when `@ctxr/mcp-github` is on npm, switch `args` to `["-y", "@ctxr/mcp-github"]`. Same shape, faster cold start (no build at runtime).
>    - **Clone and build (offline, fastest start):** clone the repo once into an ignored directory and point `command: node` at the built server with a relative path (never absolute). The clone is a local build artifact, not project source, so add it to `.gitignore` first:
>      ```sh
>      grep -qxF '.tools/' .gitignore 2>/dev/null || printf '%s\n' '.tools/' >> .gitignore
>      git clone https://github.com/ctxr-dev/mcp-github .tools/mcp-github
>      ( cd .tools/mcp-github && npm ci && npm run build )
>      ```
>      then set `"command": "node", "args": ["./.tools/mcp-github/dist/server.mjs"]`.
>    - **Formal installer:** a dedicated `mcp-github-install` CLI is planned; this step collapses to a single command once it lands.
>
>    </details>
>
> 5c. **Offer the recommended review subagents (recommended, opt-in).** The `agents_orchestration` recipe fans work out to three small, read-only, tool-agnostic subagents, installed once at user scope so they are available in every project:
>    - `agent-codebase-explorer` - locates code (where-is-X / what-references-Y) during planning fan-out.
>    - `agent-plan-reviewer` - adversarially reviews a plan before you commit to it (powers the optional plan-review gate).
>    - `agent-implementation-auditor` - audits built work against its plan at merge-prep (powers the optional conformance-review gate).
>
>    **Ask the user once:** *"Install the 3 recommended review subagents at user scope, so they are available in every project? (y/n)"* On **yes**, install them globally for the user with `@ctxr/kit`:
>    ```sh
>    npx @ctxr/kit install --user @ctxr/agent-codebase-explorer @ctxr/agent-plan-reviewer @ctxr/agent-implementation-auditor
>    ```
>    On **no**, skip - the methodology still works and the orchestrator runs the fan-out and the review gates inline. The two review agents earn their keep under `subagent_review` (on in the `single-issue` and `full` presets). See [`agents-orchestration.md`](agents-orchestration.md) for how they are used.
>
> 6. **Pick a feature preset.** Ask the user once:
>    > "Which features do you need?"
>    > - **`pr-only`** - PR loop, Copilot review, conventional commits, agents orchestration, audit-vs-execute. No issues, no project board.
>    > - **`single-issue`** - `pr-only` + issue lifecycle + canonical issue schema. Still no project board.
>    > - **`full`** - `single-issue` + plan-to-issues, parallel validation, plan deprecation, cold-start, label taxonomy + native Issue Type.
>
>    Write a `### Features` table under the active `## Project: <slug>` section in the config with the 13 booleans set per the chosen preset (see `local-config.md` for the per-preset matrix). The template's defaults already match `pr-only` - for `single-issue` flip `issue_schema` + `issue_lifecycle` + `subagent_review` to `true`; for `full` flip all of them to `true`.
>
> 7. **Fill the config.** Ask the user for every field in the active project section. For fields not used by the chosen preset (e.g. `project_url` and `sibling_repos` under `pr-only`), record `<not used: pr-only>` rather than leaving the placeholder - that way the value is unambiguous if the user later upgrades the preset.
>
> 8. **Bootstrap.** Read `.agents/ctxr-dev/github-dev-methodology/index.md` and follow it. Honour the active features per the index preamble: never bootstrap a recipe whose `feature` is off, and never ask the user for config values that belong only to disabled features.

After install, every future session in this project picks up the methodology automatically. To update: `cd .agents/ctxr-dev/github-dev-methodology && git pull`.

---

## Why `.agents/` and `.gitignore`

The methodology is its **own git repository** (cloned under `.agents/ctxr-dev/github-dev-methodology/`). The outer project must **not** track it - otherwise you get nested-`.git/` warnings, methodology updates appearing as foreign diffs in your PRs, and accidental commits of methodology content into your project.

The `*.local.md` rule keeps the per-project config private to each developer: it holds project URLs, org names, the reviewer set (and required-approver subset), and auto-discovered bot IDs.

---

## Per-project configuration

| Field | Value |
|---|---|
| **Path** | `<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` |
| **Template** | [`templates/config.local.md`](templates/config.local.md) |
| **Shape** | One file, one or many GitHub Projects. `## Active` + `## Project: <slug>` sections. |
| **Selection** | Default = `active_project` in the file. Override per invocation with `--project <slug>`. Schema details: [`local-config.md`](local-config.md). |

---

## Agent compatibility

| Agent | Reads `AGENTS.md` natively? | Wired by install prompt |
|---|:-:|---|
| OpenAI Codex CLI | ✅ | direct |
| Cursor | ✅ | direct |
| GitHub Copilot | ✅ | direct |
| Aider · Continue · Cline · Zed · Warp | ✅ | direct |
| **Claude Code** | ❌ *(May 2026)* | via `@AGENTS.md` import in `CLAUDE.md` |

The methodology docs themselves contain **no agent-specific tool names**: they describe capabilities ("read the file", "block in the foreground until the review watch returns") that map to whatever primitives your agent harness provides. The optional `gh_pr_review_watch` MCP tool is vendor-neutral (any client calls it the same way); a no-MCP `scripts/pr-review-watch.mjs` fallback covers harnesses without it.

---

## Layout

```
github-dev-methodology/
├── AGENTS.md                       entry-point pointer (read first)
├── index.md                        topic index + read order
├── pr-loop.md                      PR review loop
├── plan-to-issues.md               plan migration recipe
├── issue-lifecycle.md              single-issue / single-PR flow
├── issue-schema.md                 canonical body shape
├── label-taxonomy.md               locked label families + native Type mapping
├── cold-start.md                   pick up an issue with zero context
├── agents-orchestration.md         orchestrator + subagent pattern
├── parallel-validation.md          3-agent post-migration audit
├── commits.md                      conventional commits + reviewer request
├── plan-deprecation.md             post-migration plan minimization
├── audit-vs-execute.md             findings ≠ approval
├── local-config.md                 per-project config schema
├── templates/
│   ├── config.local.md             per-project config template
│   └── labels/default-taxonomy.yaml  locked label families
└── scripts/                        4 Node validators (Node ≥ 20)
```

---

<details>
<summary><strong>Legacy installs (from the old <code>.claude/memory/</code> layout)</strong></summary>

<br/>

Existing projects that installed the previous Claude-only layout can migrate manually. Use plain `mv` (not `git mv`) - the old paths were gitignored, so git doesn't know about them:

```sh
mkdir -p .agents/ctxr-dev
mv .claude/memory/ctxr-dev .agents/ctxr-dev/github-dev-methodology
mv .claude/memory/ctxr-dev.config.local.md .agents/ctxr-dev/github-dev-methodology.config.local.md
```

Then rewire `AGENTS.md` per step 3 of the install, update `.gitignore` per step 2, and replace the old single-project table in your config with the new `## Active` + `## Project: <slug>` layout (see [`templates/config.local.md`](templates/config.local.md)). **Add a `### Features` block** to each project section (the parser treats any feature not listed as `false`, so start with the `full` preset if your old install used the whole methodology). **Drop the `polling_paradigm` row** if present - it's gone; polling is always foreground.

</details>

---

<div align="center">

Made by <a href="mailto:dmitri.meshin@gmail.com"><strong>Dmitri Meshin</strong></a>, distilled from real <a href="https://github.com/ctxr-dev">ctxr-dev</a> project work.

<sub>MIT licensed - see <a href="LICENSE">LICENSE</a>.</sub>

</div>
