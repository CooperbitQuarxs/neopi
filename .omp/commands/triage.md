# Triage Command

Classify/label newly opened GitHub issues missing labels.

## Arguments

`$ARGUMENTS`: optional `--days <n>`; default `7`. Triage only open issues created within this window.

## Steps

### 1. Fetch

Parse `$ARGUMENTS` for `--days` (default `7`).

```bash
# Build cutoff date (UTC) for "new" issues
CUTOFF_DATE="$(python - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d'))
PY
 )"

# Fetch only newly created open issues (default 7-day window)
gh issue list --state open --search "created:>=${CUTOFF_DATE}" --json number,title,body,labels,comments,createdAt --limit 50
```

### 2. Candidates

Label vocabulary is the fork's, defined in `docs/policy/README.md` › Labels (source of truth; triage-label meanings in `docs/agents/triage-labels.md`). NEVER create labels.

Skip issues older than cutoff. Of the rest, skip only if all hold:
- Exactly one type: `bug`|`enhancement`|`documentation`|`question`|`duplicate`|`invalid`.
- Exactly one `priority: p0`…`priority: p3`.
- Exactly one definitive triage state: `needs-info`|`ready-for-agent`|`ready-for-human`|`wontfix`. An issue still carrying `needs-triage`, or carrying two states, is never complete.

### 3. Classification

For every candidate, read title, body, and all comments; comments may contain critical context.

**Type** (exactly one)
- `bug`: broken existing behavior—crash, error, regression, "doesn't work".
- `enhancement`: feature request/improvement to existing behavior.
- `question`: how-to, clarification, usage question.
- `documentation`: missing, incorrect, outdated docs.
- `invalid`: spam, off-topic, not actionable.
- `duplicate`: clear duplicate; reference original in a comment.

**Priority** (exactly one)
- `priority: p0`: critical blocker, data loss/security breakage, unusable workflow.
- `priority: p1`: high impact, common workflow broken, fix soon.
- `priority: p2`: medium impact, workaround exists, not blocking most users.
- `priority: p3`: low impact, edge case/minor issue.

**Effort** (when estimable): `effort: tiny`|`effort: small`|`effort: medium`|`effort: large`|`effort: very large`.

**Triage state** (exactly one; meanings in `docs/agents/triage-labels.md`)
- `needs-triage`: unclassified, maintainer must evaluate.
- `needs-info`: waiting on reporter.
- `ready-for-agent`: fully specified, an agent can implement it.
- `ready-for-human`: needs human work or a decision.
- `wontfix`: intentional behavior or explicitly out of scope.

**Other** — only with explicit evidence: `baseline`, `upstream-sync`, `hotfix`, `entangled`, `downstream`, `rpc`, `t3c-npi`, `npi-deck`, `codex-review`, `sentinel-review-requested`.

### 4. Apply

Apply chosen labels. Remove `needs-triage` when a definitive state replaces it, and remove any conflicting triage-state label so exactly one remains. NEVER remove other labels.

```bash
gh issue edit <number> --add-label "bug,priority: p1,effort: small,ready-for-agent"
```

### 5. Summary

After all issues, print:

```
## Triage Summary

|#|Title|Added Labels|Skipped|
|---|---|---|---|
|42|Tool call stalls after retry|bug, priority: p1, effort: small, ready-for-agent||
|38|Add provider fallback routing|enhancement, priority: p2, effort: medium, ready-for-human||
|35|How to configure API key rotation|question, needs-info||
|30|Existing labels complete||Already labeled|
```

Then: `Processed: X | Labeled: Y | Skipped: Z`

## Rules

- Only labels from `docs/policy/README.md` › Labels; no `prio:*`, `provider:*`, `platform:*`, or `area:*`.
- Automated triage: do not apply `good first issue` or `help wanted`; maintainer judgment required.
- Sparse body → classify from all comments; do not skip before reading them.
