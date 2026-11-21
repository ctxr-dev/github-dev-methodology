---
feature: plan_to_issues
requires:
  features: [issue_schema]
  config: [project_url, org, primary_repo]
---

# Plan to issues

How to turn a plan into a native sub-issue tree on a GitHub Project. You write a manifest. `gdm plan sync` creates and wires the issues, and can be run again safely.

This is Lane 2 in [`../SKILL.md`](../SKILL.md): several independent deliverables, or work across repos.

When `subagent_review` is on, offer the plan-review gate before you write the manifest (see [`agents-orchestration.md`](agents-orchestration.md), "Optional review gates").

## Outcome

- Every actionable plan item is a GitHub issue with the body sections from [`issue-schema.md`](issue-schema.md).
- Issues form a native sub-issue tree under one epic. Every leaf reaches the root in at most 4 hops.
- Blockers are native issue dependencies.
- Issue types, issue fields and project fields are set and read back.
- Every issue is on the project board when `project_url` is set.
- The plan file is minimized afterwards ([`plan-deprecation.md`](plan-deprecation.md)).
- Touched issues are audited ([`parallel-validation.md`](parallel-validation.md)).

## 1. Write the manifest

One JSON file plus one Markdown body file per item. Body files are paths relative to the manifest.

```json
{"plan_id":"<slug>","repo":"<owner/repo>","project_url":null,
 "items":[{"key":"EPIC","title":"…","type":"Epic","body_file":"epic.md","parent":null,
           "blocked_by":[],"repo":null,"labels":[],"fields":{},"project_fields":{}}]}
```

| Key | Meaning |
|---|---|
| `plan_id` | Stable slug. Part of the idempotency marker, so never change it after the first sync. |
| `repo` | Default repo for every item (`owner/repo`). |
| `project_url` | Project board URL, or `null` to skip the board. |
| `items[].key` | Short unique name used for references, such as `EPIC`, `A`, `RUNNER`. |
| `items[].type` | Native Issue Type name (`Epic`, `Feature`, `Bug`, `Task`). |
| `items[].body_file` | Body written from [`../assets/issue-body.md`](../assets/issue-body.md) or [`../assets/epic-body.md`](../assets/epic-body.md). |
| `items[].parent` | Key of the parent item, or `null` for the root. |
| `items[].blocked_by` | Keys of items that must close first. |
| `items[].repo` | Override for an item in another repo, or `null`. |
| `items[].labels` | Extra labels, for example `phase:*` or `area:*`. |
| `items[].fields` | Issue fields (Priority, Effort) by name. |
| `items[].project_fields` | Project fields (Status, and Priority or Effort when the org has no issue fields). |

A complete example is `tests/fixtures/plan/sample.json` in the methodology repo.

### Placeholders

An item body may point at another item with `{{KEY}}`. Sync replaces it with `#N` in the same repo, or `owner/repo#N` across repos. An unresolved placeholder stops that item: sync writes nothing for it and exits 1.

Write exactly one root. Put dependent items under the same epic and describe the order with `blocked_by`, not with prose.

## 2. Dry run

```bash
gdm plan sync <manifest.json> --dry-run
```

Prints the action list in creation order and writes nothing. Check it before the real run. A dependency cycle in `parent` or `blocked_by` exits 1 here, before any write.

## 3. Sync

```bash
gdm plan sync <manifest.json>
```

Order is topological over `parent` and `blocked_by`. Per item, sync:

1. Renders the body and adds the marker `<!-- gdm:plan=<plan_id>:<key> -->`.
2. Creates the issue with its type, parent and blockers.
3. Sets issue fields, then reads them back. A mismatch exits 1 and names the field.
4. Adds the issue to the project and sets `project_fields` when `project_url` is set.

Content-creating calls are at least 1 second apart, to stay below GitHub's secondary rate limit.

If the org has no issue fields, Priority and Effort go to project fields and sync logs `issue fields unavailable`.

### Idempotency

Run sync again after any failure. It does not create duplicates:

- A ledger records key to issue URL after every create. It lives at `~/.github-dev-methodology/state/<host>/<owner>/<repo>/plans/<plan_id>.ledger.json`.
- With no ledger entry, sync searches the repo for the body marker before it creates.
- A rerun fills in missing parent or blocker links. "Already linked" errors are tolerated.
- A full rerun reports `0 created`.

Do not delete the ledger. If you must, the marker search still protects you.

## 4. Validate

```bash
gdm validate tree <epic-url>
gdm validate issues <owner/repo> --touched <numbers>
gdm validate labels <owner>
```

All must exit 0 before you call the migration done. `validate tree` fails on an orphan, a cycle, a depth above 4, or a parent and child that disagree.

## 5. Audit and minimize

1. Run the three-way audit in [`parallel-validation.md`](parallel-validation.md), scoped to touched issues.
2. Minimize the plan file per [`plan-deprecation.md`](plan-deprecation.md). This is the last step.

## Related

- [`label-taxonomy.md`](label-taxonomy.md): labels and Issue Types.
- [`configuration.md`](configuration.md): `project_url`, `org`, `primary_repo`.
- [`issue-lifecycle.md`](issue-lifecycle.md): how each child is then executed.
