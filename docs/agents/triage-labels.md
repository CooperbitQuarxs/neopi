# Tracker labels

This is the settled part of the replacement taxonomy, not the finished policy
or setup skill. Labels compose: a type, an estimate, a relationship and a
specification describe different facts. Additional repository-specific labels
are not removed merely because they are absent from this guide.

## Available vocabulary

| Axis | Labels | Meaning |
| --- | --- | --- |
| Type and context | `accessibility`, `bug`, `documentation`, `enhancement`, `hotfix` | Apply when the issue's evidence supports the description |
| Idea and experiment | `idea`, `experiment` | An undecided possibility or an experimental approach; neither starts authorized work |
| Specification | `spec` | The issue is or contains an implementation specification, not merely a brainstorm with headings |
| Relationship | `downstream`, `entangled`, `duplicate` | A consumer dependency, incompatible alternatives, or a verified duplicate |
| Assessment | `needs-triage`, `needs-info`, `invalid`, `wontfix` | Assessment needed, missing information, invalid report, or an explicit decision not to proceed |
| Priority | `priority: p0`, `priority: p1`, `priority: p2`, `priority: p3` | Use the repository's documented priority meanings; do not invent a new scale |
| Time | `frame: hours`, `frame: days`, `frame: weeks`, `frame: months`, `frame: years` | Estimated time with estimator and normalization provenance |
| Existing implementation | `stale: identical`, `stale: similar` | Verified equivalent implementation, or a partial/different implementation with remaining scope |

`experiment` replaces `experimental idea`. It can coexist with `idea`, `bug`
or another applicable type. Experimental work stays on an experimental topic
branch; moving it into `nightly` or the default branch needs a separate owner
decision. `spec` may accompany a collapsible `<details>` specification in the
issue body. Its presence does not establish permission, current ownership or
merge eligibility.

`entangled` is for alternatives where choosing one supersedes the others,
not ordinary dependencies or merely related issues. Preserve the unresolved
owner choice rather than assigning all alternatives for AFK implementation.

### Difficulty

Available bands are `difficulty: 0.000-0.125`, `difficulty: 0.125-0.250`,
`difficulty: 0.250-0.375`, `difficulty: 0.375-0.500`,
`difficulty: 0.500-0.625`, `difficulty: 0.625-0.750`,
`difficulty: 0.750-0.875` and `difficulty: 0.875-1.000`.
Lower bounds are inclusive; upper bounds are exclusive except for `1.000`.
Difficulty is separate from time and priority. Record the estimate's source;
do not infer a score from an unexplained historical title prefix or rewrite
titles as part of a label pass.

### Time estimates

For a fresh agent-authored estimate, normalize down exactly one step:
years → months → weeks → days → hours. Hours is the floor. Human-authored
estimates stay unchanged. Record the estimator, original estimate and whether
normalization has already happened so another triage pass does not shrink it
again.

Historical `effort:*` tiers are not literal durations. Do not convert them
automatically to frames, require them on new issues, or erase existing labels
without reviewing their meaning.

## Operational names during cutover

The target name `upstream` covers substantive upstream involvement, not only
release synchronization. A fork-local manifestation does not rule out upstream
origin. The current operational label is still `upstream-sync`: migrate literal
consumers, including the promotion workflow, before renaming it.

The target name `mergeable` means the repository's documented merge criteria
are met. It does not grant permission to merge a default branch. The current
operational label remains `ready-for-merge` until the workspace policy and
consumers are cut over together. Keep using the current name in live PR work;
do not create parallel aliases or claim this rename has happened.

The proposed removal of `baseline` is unresolved. Keep the existing label and
its base-branch evidence; do not translate every baseline into `upstream`.

## Legacy readiness and open decisions

| Existing role/label | Interim handling |
| --- | --- |
| `needs-triage` | Needs initial or renewed assessment |
| `needs-info` | Identify the concrete missing information and who can supply it |
| `ready-for-agent` | Legacy AFK-readiness marker; verify the current contract and authorization before pickup |
| `ready-for-human` | Legacy human-required routing marker; not a finalized participation state |
| `wontfix` | Record the decision not to proceed |

Keep these exact names when existing skills refer to their canonical roles.
Do not invent replacement spellings while the actor-state design is open.
The human/agent pending, started and finished concepts describe participation:
started signals claimed work; finished need not mean the whole PR is
mergeable. Exact names and transition rules are not finalized. Reviewer-state
syntax and the separate upstream-conflict/user-disruption axes also remain
open.

The evidence-led reconciliation procedure is in `issue-tracker.md`.

## Deselected families

Do not add deselected labels to new triage assignments: this includes
`effort:*`, `good first issue`, `help wanted`, `question`, `rpc`,
`neopi-upstream`, `npi-deck`, `t3c-npi`, `codex-review`,
`sentinel-review-requested`, and the size, vouch, wayfinder and native-change
families. Preserve existing associations until an evidence-led cutover;
deselection is not an unconditional deletion order.

The current operational PR/readiness names above remain in use while their
replacement is unresolved. Do not bypass an existing required review merely
because the future label family is being redesigned.
