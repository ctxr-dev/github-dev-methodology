# Plan → Issues migration recipe

The canonical 10-step recipe for taking a markdown plan file and migrating its content into a wired native sub-issue tree on a GitHub Project.

## Outcome

After this recipe runs:

- Every actionable item from the plan exists as a GitHub Issue.
- Every issue body follows the canonical schema (see [`issue-schema.md`](issue-schema.md)). `validate-issue-schema.mjs` passes.
- Issues are wired into a native sub-issue tree (`addSubIssue` GraphQL mutation) rooted at a single epic.
- Every leaf walks its parent chain to the root in ≤ 4 hops. `validate-tree.mjs` passes.
- Every issue is added to the project board with Status / Priority / Size fields populated.
- Cross-repo dependencies are encoded as `Blocked by:` lines in issue bodies AND (when same-repo) as native sub-issue links.
- The original plan file is minimized to title + 1-paragraph + epic link (see [`plan-deprecation.md`](plan-deprecation.md)).
- After execution, 3 parallel Plan agents validate completeness / dep-graph / cold-start readiness — SCOPED TO TOUCHED ISSUES (see [`parallel-validation.md`](parallel-validation.md)).

## 10-step recipe

### Step 0 — Substitution table (mandatory)

GitHub assigns issue numbers at creation; the body of issue #N may need to reference issue #M created later. Maintain a running map:

```text
<placeholder>           → real-issue-#
EPIC                    → ?
SUBSTRATE               → ?
RUNNER                  → ?
... (one per issue you'll create)
```

After every `gh issue create`, capture the returned URL → number. Render every later issue body with the table applied. **Without this, sub-issue links are broken at creation time.**

### Step 1 — Bootstrap canonical labels (cascade across all repos in the project)

For every repo that will contribute issues to the project, install the canonical label families. See [`label-taxonomy.md`](label-taxonomy.md) for the full list. Sample:

```bash
for REPO in <REPO_1> <REPO_2> ...; do
  for label in \
    "type:epic|Umbrella parent issue with sub-issues|5319E7" \
    "type:feature|New capability|0E8A16" \
    "type:enhancement|Improvement to existing capability|0075CA" \
    "type:bug|Defect|D73A4A" \
    "type:refactor|Internal restructure, no behaviour change|1D76DB" \
    "type:docs|Documentation|0052CC" \
    "type:chore|Maintenance / infrastructure|C5DEF5" \
    "scope:breaking|Breaks backward compatibility|B60205" \
    "scope:additive|Additive only; no breaking change|E99695"; do
    name=${label%%|*}; rest=${label#*|}; desc=${rest%%|*}; color=${rest##*|}
    gh label create "$name" --repo <OWNER>/$REPO --description "$desc" --color "$color" --force >/dev/null 2>&1
  done
done
```

Project-specific `area:*` and `phase:*` labels are added per-repo as needed (see [`label-taxonomy.md`](label-taxonomy.md)).

### Step 2 — Create the EPIC stub first

Create the root epic with placeholder children (back-fill the children list at Step 7). This gives every later issue a real `#NN` to point at as `Parent`.

```bash
EPIC_URL=$(gh issue create --repo <OWNER>/<REPO> \
  --title "Epic: <Roadmap Title>" \
  --body "$(cat <<EOF
> **Status:** Stub — full body back-filled at Step 7 once all children exist.

## Mission
<one paragraph>

## Children
To be back-filled at Step 7.
EOF
)" \
  --label "type:epic,phase:<phase>,scope:additive" 2>&1 | tail -1)
echo "EPIC = $EPIC_URL"
```

Capture the epic's number into the substitution table.

### Step 3 — Create cross-repo dependency epics (if applicable)

If the plan crosses repos, create the dependency epics for each involved repo too. Each becomes a native sub-issue of the root epic later (Step 6). Same stub treatment as Step 2.

### Step 4 — Create child issues IN DEPENDENCY ORDER (leaves before umbrellas)

For each leaf-level issue: `gh issue create` with the canonical body schema (see [`issue-schema.md`](issue-schema.md)). Capture each returned `#NN` to the substitution table BEFORE creating the next issue that references it.

Closed-on-creation issues (work already done): create open with the schema, then `gh issue close <num> --reason completed --comment "Implemented in PR #<n> commit <sha>"`.

### Step 5 — Create umbrella / sprint-summary issues

After all children exist, create umbrellas. Their bodies reference the real `#NN` of the children. This is why ordering matters — umbrellas can't be authored without the children's numbers.

### Step 6 — Wire native sub-issue tree (GraphQL `addSubIssue`)

Native parent-child links (clickable in the GH UI). Resolve every issue's node id, then call `addSubIssue` per parent-child pair:

```bash
# Get node ID:
PID=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<PARENT_NUM> --jq '.data.repository.issue.id')
CID=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
  -f o=<OWNER> -f r=<REPO> -F n=<CHILD_NUM> --jq '.data.repository.issue.id')

# Wire:
gh api graphql -f query='mutation($pid:ID!,$cid:ID!){addSubIssue(input:{issueId:$pid,subIssueId:$cid}){issue{number}subIssue{number}}}' \
  -f pid="$PID" -f cid="$CID"
```

Cross-repo links work as long as the user can read both repos.

### Step 7 — Back-fill epic bodies with real child references

Edit each epic's body to replace placeholder content with a full sub-issue table including real `#NN` numbers. The substitution table built throughout Steps 2–6 makes this mechanical.

### Step 8 — Add issues to the project board + populate fields

```bash
# Add:
gh project item-add <PROJECT_NUM> --owner <OWNER> --url <issue-url>

# Get field IDs once (cache):
gh api graphql -f query='{ organization(login: "<OWNER>") { projectV2(number: <PROJECT_NUM>) { fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } }'

# Set Status / Priority / Size per item (single-select fields):
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$v}}){projectV2Item{id}}}' \
  -f p=<PROJECT_NODE_ID> -f i=<ITEM_NODE_ID> -f f=<FIELD_NODE_ID> -f v=<OPTION_ID>
```

### Step 9 — Validate (run all 4 scripts)

```bash
cd .agents/ctxr-dev/github-dev-methodology/scripts
node validate-tree.mjs <ROOT_EPIC_URL>            # parent chain reaches root
node validate-issue-schema.mjs <OWNER>/<REPO>     # body shape per issue
node validate-labels.mjs <OWNER>                  # label consistency cross-repo
node diff-plan.mjs <PLAN_FILE> <PROJECT_URL>      # plan vs actual project state
```

ALL must pass before the migration is declared done.

### Step 10 — Spawn 3 parallel Plan agents (scoped to TOUCHED issues only)

See [`parallel-validation.md`](parallel-validation.md). Three agents in parallel:
- **Completeness audit** — every promised artefact exists.
- **Dep-graph validation** — no cycles, no orphans, all chains terminate at root.
- **Cold-start readiness** — sample 3-5 of the touched issues; verify each is self-contained.

Apply highest-leverage findings before declaring migration done.

### Step 11 — Minimize the original plan file

Per [`plan-deprecation.md`](plan-deprecation.md), the agent rewrites the plan file in-place to its minimal form (title + 1-paragraph + epic link), commits as `docs: migrate plan to <epic-link>`. This is the FINAL step.

## Idempotency

- `gh issue create` is NOT idempotent (each call creates a new issue). Always check for the substitution table BEFORE re-running.
- `addSubIssue` errors gracefully when the link already exists ("already a sub-issue"). Safe to re-run.
- Project `item-add` is idempotent (re-add returns the same item ID).
- Label create with `--force` is idempotent (creates or updates).

If a migration is interrupted mid-way, replay from the last successful step using the substitution table. Don't blindly re-create issues.
