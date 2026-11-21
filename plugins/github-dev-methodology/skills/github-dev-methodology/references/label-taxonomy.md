---
feature: label_taxonomy
requires:
  features: []
  config: [org]
---

# Label taxonomy

A small, fixed set of labels, the same in every repo of the project. The source of truth is [`../assets/labels.json`](../assets/labels.json). This page explains the rules.

## Rules

| Family | Status | Rule |
|---|---|---|
| `type:*` | Locked | Only when the org has no native Issue Types. Exactly one per issue. |
| `scope:*` | Locked | Semver signal: `scope:breaking` or `scope:additive`. Exactly one per issue. |
| `phase:*` | Extensible | Project phase. Each project picks its own names. |
| `release:*` | Extensible | Target release, such as `release:v2.0`. Optional. |
| `area:*` | Extensible | Subsystem. An issue may carry several. |

Locked labels have the same name, color and description in every repo. Extensible families use the color in `project_extensible_color_conventions` of `labels.json`.

### Locked labels

`type:epic`, `type:feature`, `type:enhancement`, `type:bug`, `type:refactor`, `type:docs`, `type:chore`, `scope:breaking`, `scope:additive`. Colors and descriptions are in `labels.json`.

### Extensible colors

- `phase:*`: `FBCA04`
- `release:*`: `0E8A16`
- `area:*`: `8B4FBC`

## Install and check

```bash
gdm validate labels <OWNER>
gdm validate labels <OWNER> --repos repo-a,repo-b
gdm validate labels <OWNER> --fix
```

Without `--fix` the command only reports drift and exits 1 when it finds any. With `--fix` it creates or repairs the locked set in every repo and exits 1 if any repair failed.

## Not a label

- **Priority and Effort**: issue fields when the org has them, else project fields.
- **Status**: project field `Status` (`Backlog`, `Ready`, `In progress`, `In review`, `Done`).
- **Kind of work**: the native Issue Type when the org has types.

Labels carry meaning. Fields carry execution state. Do not duplicate one in the other.

## Native Issue Types

GitHub orgs can define Issue Types (default `Task`, `Bug`, `Feature`; admins can add more, such as `Epic`). When the org has them, use the native type and skip the `type:*` labels.

Discover the types once per org:

```bash
gh api orgs/<OWNER>/issue-types
```

An empty array means the org has no Issue Types. Then use the `type:*` labels as the only type signal.

Mapping `epic`, `feature`, `bug` and the rest onto the org's types is the owner's decision. Show the discovered types, propose a mapping, and ask before you apply it. Never create a type in the org without the owner's explicit approval; creating one needs the `admin:org` token scope and the GraphQL mutation `createIssueType`.

Set a type at creation (`gh issue create --type <name>`) or later:

```bash
gh issue edit <N> --repo <OWNER>/<REPO> --type <name>
```

## Token scopes

`gdm doctor` lists the missing `gh` scopes for the enabled features and prints the one `gh auth refresh` command to run. Run that single command and do not ask for scopes one at a time.

## Related

- [`issue-schema.md`](issue-schema.md): where type, priority and status live.
- [`plan-to-issues.md`](plan-to-issues.md): sync sets types and labels.
