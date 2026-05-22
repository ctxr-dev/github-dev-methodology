---
feature: label_taxonomy
requires:
  features: []
  config: [org]
---

# Label taxonomy

Locked label families propagate across every repo in the project. Project-extensible families allow per-project specialization.

## Locked families (same names + colors across every repo)

| Family | Lock status | Color family |
|---|---|---|
| `type:*` | Locked | Blue tones (`5319E7` for epic; `0E8A16` for feature; `D73A4A` for bug; etc.) |
| `scope:*` | Locked | Red tones (`B60205` for breaking, `E99695` for additive) |
| `phase:*` | Locked structure (specific phase names per project) | Yellow (`FBCA04`) |
| `release:*` | Locked structure | Green (`0E8A16`) |
| `area:*` | Open (project extends) | Purple (`8B4FBC`) |

## Canonical labels (template)

See [`templates/labels/default-taxonomy.yaml`](templates/labels/default-taxonomy.yaml) for the full canonical set as a YAML file consumers can `gh label create` cascade-install.

### `type:*` — kind of work (mutually exclusive)

- `type:epic` (color `5319E7`) — Umbrella parent issue with sub-issues.
- `type:feature` (color `0E8A16`) — New capability.
- `type:enhancement` (color `0075CA`) — Improvement to existing capability.
- `type:bug` (color `D73A4A`) — Defect.
- `type:refactor` (color `1D76DB`) — Internal restructure, no behaviour change.
- `type:docs` (color `0052CC`) — Documentation.
- `type:chore` (color `C5DEF5`) — Maintenance / infrastructure.

Every issue gets exactly ONE `type:*` label. Project-extensible: NO. Locked across all repos.

### `scope:*` — semver signal

- `scope:breaking` (color `B60205`) — Breaks backward compatibility.
- `scope:additive` (color `E99695`) — Additive only; no breaking change.

Every issue gets exactly ONE `scope:*` label. Locked across all repos.

### `phase:*` — project phase grouping (project-extensible)

Each project picks its own phase names. Examples:
- skill-code-review uses `phase:sprint-b`, `phase:sprint-2`, `phase:sprint-c`, `phase:sprint-3`, `phase:sprint-4`, `phase:sprint-d`, `phase:sprint-5`, `phase:release`.
- agent-staff-engineer uses `phase:P0-foundations`, `phase:P1-remote-sync`, `phase:P2-missing-skills`, `phase:P3-orchestration`, `phase:P4-observability`, `phase:P5-fsm`.
- mcp-github uses `phase:v0.1`, `phase:v0.2`.

Color: `FBCA04` (yellow) for every `phase:*` regardless of project.

### `release:*` — target release

E.g. `release:v2.0`, `release:v0.1`, etc. One per issue if relevant; not all issues need one. Color: `0E8A16` (green).

### `area:*` — subsystem (multi-select OK; project-extensible)

E.g. `area:bootstrap`, `area:tracker-sync`, `area:fsm`, `area:orchestration`, `area:integration`, etc. Each project adds its own. Color: `8B4FBC` (purple) for consistency across repos.

A single issue can carry multiple `area:*` labels when it genuinely spans subsystems. Default color enforced; descriptions are project-specific.

## Cascade install (per-project)

When initialising a new project that imports this methodology:

```bash
# Install locked labels across every repo in the project:
for REPO in <REPO_1> <REPO_2> ...; do
  while IFS='|' read -r name desc color; do
    [ -z "$name" ] && continue
    gh label create "$name" --repo <OWNER>/$REPO --description "$desc" --color "$color" --force >/dev/null 2>&1
  done < <(npx --yes js-yaml templates/labels/default-taxonomy.yaml | jq -r '.locked[] | "\(.name)|\(.description)|\(.color)"')
done
```

Or use the validator:

```bash
node scripts/validate-labels.mjs <OWNER>           # report missing or drifted labels
node scripts/validate-labels.mjs <OWNER> --fix     # cascade-install canonical set
```

## What's intentionally NOT a label

- **Priority** (P0/P1/P2/P3) — lives in the project board's `Priority` field, not as a label. Project field supports filtering / sorting; labels add visual noise.
- **Size** (S/M/L/XL) — lives in the project board's `Size` field. Same rationale.
- **Status** — project board's `Status` field. Reserved values: Backlog / Ready / In progress / In review / Done.
- **Native GitHub Issue Type** — set via GraphQL `updateIssueIssueType` per the section below. Coexists with the `type:*` label.

This split is per the canonical taxonomy spec — keep labels for semantic categorisation, project fields for execution-state tracking. Don't duplicate.

## Native GitHub Issue Type integration (per-org discovery)

GitHub Issues now has a built-in **Type** field (separate from labels) that
admins configure at the org level. Common types are `Task`, `Bug`, `Feature`,
sometimes `Epic` if the org adds it. The native field renders as a chip in
the GitHub UI and supports project-board grouping/filtering separately from
labels.

ctxr-dev's `type:*` label family stays as the locked semantic categorisation
(7 values, identical across all repos). The native Type is a *companion*
that gets set on every issue based on a per-org mapping.

### Required gh auth scopes (ASK USER UPFRONT — single refresh)

The bootstrap touches GitHub Projects, branch protection (where
available), label cascade, issue creation, type management, and
sometimes auto-creation of native Issue Types at the org level. Each of
these requires a different `gh` token scope. Do NOT ask for scopes
piecemeal across the bootstrap (that frustrates the user). At the start
of the bootstrap, present a SINGLE `gh auth refresh` command that adds
every scope the methodology might need:

```bash
gh auth refresh -h github.com -s read:org,admin:org,project,workflow,admin:repo_hook,admin:org_hook,repo
```

Scope breakdown:
- `repo` — full read/write on private repos (issues, labels, code, branches).
- `read:org` — list org members and resources (covered by `admin:org`).
- `admin:org` — REQUIRED to call `createIssueType` (only org admins can add new native Issue Types). If the user is not an org admin, omit this scope; the agent must NOT auto-create types and instead present the "use existing types only" branch of the mapping question.
- `project` — read + write GitHub Projects v2 (item-add, field-update).
- `workflow` — touch `.github/workflows/*` if the bootstrap installs CI gates.
- `admin:repo_hook` and `admin:org_hook` — manage repo + org webhooks if the bootstrap installs any (rarely needed; cheap to include).

If the user can't grant `admin:org`, drop that scope from the refresh and constrain the type-mapping question to "use existing types only" — auto-create options are unavailable.

### Discovery (MANDATORY before any issue creation; run once per org)

```bash
gh api orgs/<ORG>/issue-types
```

Returns a JSON array of every Issue Type the org admin has configured.
The default GitHub installation provides `Task`, `Bug`, `Feature`. Orgs
can add custom types (e.g. `Epic`, `Spike`, `Story`, `Documentation`,
`Chore`, `Refactor`, `Research`, `Incident`, anything they want). The
returned array is the only source of truth for what's available; never
assume.

If the call returns `[]` (the feature is disabled for this org), record
that in `github-dev-methodology.config.local.md` and skip the type-setting step
entirely — the `type:*` label alone is the type signal in that case.

For each non-empty result, capture `node_id` (looks like
`IT_kwDOXXXXXXXXXX`) plus `name`, `color`, `description`. Record in
`<project-root>/.agents/ctxr-dev/github-dev-methodology.config.local.md` under a section
titled `## GitHub native Issue Types (org-level, <ORG>)` with a table.

### Mapping `type:*` → native Issue Type (ALWAYS ASK USER)

The mapping from ctxr-dev's 7 `type:*` label suffixes to the org's
native Issue Types is project-specific. **The agent MUST NOT autopilot
this mapping.** Always run discovery first, then ask the user directly
which mapping they want for each `type:*` value. The agent's role is to:
1. Show what's currently configured (discovered types).
2. List the realistic options (existing types, auto-create, label-only).
3. Ask which mapping the user wants for each `type:*`.
4. Record the chosen mapping in `github-dev-methodology.config.local.md`.
5. Apply the mapping consistently going forward (and to any existing
   issues already created under a previous mapping).

### Available approaches the user can choose from

When the agent asks the user how to map `type:*` values, present these
options. Each `type:*` value can pick a different approach.

**A. Map to an existing native type.** Use the org's currently-configured
type that best fits. Example: `type:bug` → existing `Bug` type. The
ctxr-dev label and the native type both convey "bug" but the native
type renders as a chip in the GitHub UI and supports project-board
grouping.

**B. Auto-create a new native type at the org level.** If the user has
admin permissions and wants the precise type to exist, the agent offers
to create it via the GraphQL `createIssueType` mutation. Example:
the user wants `Epic` as a distinct type → the agent creates it once,
records its node_id, then maps `type:epic` to it. Always confirm with the
user before mutating the org schema.

**C. Use the ctxr-dev `type:*` label only (no native type).** Skip
setting the native Type field for that `type:*` value. The label
alone carries the signal. Useful when the user doesn't want to
clutter the native field with rare/internal categories.

**D. Custom mapping per-issue (rare).** A `type:*` value can map to
different native types depending on context. Example: `type:enhancement`
→ `Feature` for user-facing work, → `Task` for internal-only work.
This requires per-issue declaration in the issue's frontmatter or
labels and adds complexity; only use if the user explicitly asks.

### Auto-creating a native type (option B)

If the user picks "auto-create" for one or more `type:*` values, the agent
calls the GraphQL `createIssueType` mutation per type. Requires
`admin:org` scope (see auth section above). Sample mutation:

```bash
ORG_NID=$(gh api graphql -f query='query { organization(login: "<ORG>") { id } }' --jq '.data.organization.id')

gh api graphql -f query='
mutation($oid:ID!) {
  createIssueType(input: {
    ownerId: $oid
    name: "Epic"
    color: PURPLE
    description: "Top-level mission with a sub-issue tree (umbrellas + leaves)"
    isEnabled: true
  }) {
    issueType { id name color description }
  }
}' -f "oid=$ORG_NID"
```

**`color` is an enum**, not a hex code. Valid values:
`GRAY`, `BLUE`, `GREEN`, `YELLOW`, `ORANGE`, `RED`, `PINK`, `PURPLE`.

The mutation returns the new type's `id` (looks like `IT_kwDOXXXXXXXXXX`).
Capture it immediately and write to `github-dev-methodology.config.local.md`.

If the org admin auto-creates types AFTER some issues already exist
under a different mapping (e.g. `type:epic` was collapsed to `Feature`
because there was no Epic type at bootstrap time), the agent runs a remap
pass: for every existing issue carrying the affected `type:*` label,
call `updateIssueIssueType` to switch it to the new native type. Track
the remap event in `github-dev-methodology.config.local.md` history for auditability.

### The question the agent presents

Once discovery is done, present to the user something like:

> "The cafeiner org has these native Issue Types:
> - `Task` (yellow, IT_xxx) — A specific piece of work
> - `Bug` (red, IT_xxx) — An unexpected problem or behavior
> - `Feature` (blue, IT_xxx) — A request, idea, or new functionality
>
> ctxr-dev's locked `type:*` family has 7 values: epic, feature,
> enhancement, bug, refactor, docs, chore. For each, pick a mapping
> approach: existing type / auto-create new type / label-only.
>
> Want me to propose a baseline (e.g. epic→Feature, feature→Feature,
> enhancement→Feature, bug→Bug, refactor→Task, docs→Task, chore→Task)
> and you adjust? Or do you want to specify each one explicitly?"

Record the user's answers in the project's `github-dev-methodology.config.local.md`
under `## ctxr-dev type:* → native Issue Type mapping` with one row
per `type:*` value and a comment indicating the approach used (A/B/C/D).

### Updating the mapping later

If the org adds a new native type, or the user changes their mind:
1. Re-discover via `gh api orgs/<ORG>/issue-types`.
2. Show the diff against the recorded mapping.
3. ASK the user which `type:*` values should remap.
4. For each remap: run `updateIssueIssueType` for every existing issue
   carrying the relevant `type:*` label.
5. Update `github-dev-methodology.config.local.md` history with the change date.

### Default suggestions (for the agent to PROPOSE, never auto-apply)

If the org has exactly the standard 3 types (Task/Bug/Feature) and no
custom additions, the agent may PROPOSE this baseline as the starting
point for user adjustment, but must still ASK before applying:

| ctxr-dev `type:` | Suggested native (proposal only) |
|---|---|
| `epic` | `Feature` (no native Epic; flag for user to consider creating one) |
| `feature` | `Feature` |
| `enhancement` | `Feature` |
| `bug` | `Bug` |
| `refactor` | `Task` |
| `docs` | `Task` |
| `chore` | `Task` |

The agent should also offer to auto-create custom types if the user wants
finer granularity (e.g. `Epic`, `Documentation`, `Refactor`, `Chore`).

### Updating an existing project's mapping

If the org admin adds a new native type AFTER the project bootstrapped
(e.g. they later add `Epic`):
1. Re-discover via `gh api orgs/<ORG>/issue-types`.
2. Diff against the recorded mapping in `github-dev-methodology.config.local.md`.
3. ASK the user whether to remap any existing ctxr-dev `type:*` to the
   new native type.
4. If yes, run a one-shot `updateIssueIssueType` mutation for every
   existing issue carrying the relevant `type:*` label. Track in
   `github-dev-methodology.config.local.md` history that the remap happened on
   `<date>`.

### Setting the native Type on an issue

After `gh issue create`, set the native type via GraphQL:

```bash
gh api graphql -f query='
mutation($iid:ID!,$tid:ID!) {
  updateIssueIssueType(input: {issueId: $iid, issueTypeId: $tid}) {
    issue { number issueType { name } }
  }
}' -f iid="<issue-node-id>" -f tid="<type-node-id>"
```

The `issue-node-id` comes from the create response or a follow-up
`query{repository{issue{id}}}`. The `type-node-id` is the one captured
in discovery.

If the org doesn't have native Issue Types enabled (older orgs or those
that haven't configured them), the discovery call returns `[]`. In that
case, skip the type-setting step entirely; `type:*` labels are sufficient.

### Validator implication

`validate-issue-schema.mjs` does NOT check the native Type field — that's
a project-board / API concern, not a body-shape concern. If you want a
native-Type consistency check, add it as an optional script
(`validate-native-types.mjs`) that fetches each issue's `issueType`
field and asserts it matches what the `type:*` label implies under the
config's mapping.
