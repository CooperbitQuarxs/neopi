# Issue tracker: GitHub

Issues and specs live in `PsychedelicShayna/neodeck`. Use `gh` and pass
`-R PsychedelicShayna/neodeck` on every issue, PR, and label operation:
fork discovery may otherwise resolve to the active upstream, `Shreyans13/omp-deck`.

Follow [triage.md](triage.md) for classification, actor states, reconciliation,
and closure, and [triage-labels.md](triage-labels.md) for vocabulary.

## Conventions

- Create: `gh issue create -R PsychedelicShayna/neodeck --title "..." --body-file <path>`.
- Read: `gh issue view <number> -R PsychedelicShayna/neodeck --comments`, including labels.
- Complete open-issue inventory: `gh api --paginate --slurp 'repos/PsychedelicShayna/neodeck/issues?state=open&per_page=100' | jq '[.[][] | select(has("pull_request") | not)]'`. The REST issues endpoint includes PRs, hence the filter. Read issue comments separately. For a narrowed task query, `gh issue list -R PsychedelicShayna/neodeck` is useful, but its default limit of 30 is not an exhaustive inventory.
- Apply or remove existing labels: `gh issue edit <number> -R PsychedelicShayna/neodeck --add-label "..."` or `--remove-label "..."`.
- Inspect PRs: `gh pr view <number> -R PsychedelicShayna/neodeck`.
- Inspect label definitions: `gh label list -R PsychedelicShayna/neodeck`.
- Closure follows [triage](triage.md#closure): verify full acceptance and promotion to `main`; a nightly merge alone does not satisfy it. The Issue Funnel's publication authority is defined in `docs/agents/issue-funnel.md`.
- Every GitHub comment and PR body, including review triggers, opens with `> [!NOTE]` and `> <actual Model Name> on behalf of PsychedelicShayna`. Follow [review mechanics](pr-review-bots.md) for scoped requests.
- Use existing labels only; creating or changing label definitions requires a Captain decision.

## Provenance

When an issue or idea originates in the owner's spoken or written explanation,
put a structured summary first, then preserve each message verbatim under
`## Owner's words (verbatim)`, with each message in its own `<details>` block.
For speech, transcribe it as dictated: do not clean it up. The verbatim words
take precedence wherever they differ from the summary. Do not make a local file
path the only source; readers outside the owner's machine must be able to read
the words in the issue itself.

This keeps the reasoning that produced the issue available to implementers and
to anyone upstream who follows a link downstream. Trackers often preserve the
decision while losing the thought process behind it.

Examples: [NeoPi #443](https://github.com/PsychedelicShayna/neopi/issues/443)
and [NeoPi #444](https://github.com/PsychedelicShayna/neopi/issues/444).

## Pull requests as a triage surface

**PRs as a request surface: no.** GitHub shares one number space across issues
and PRs; resolve an ambiguous number before acting.

## Skill meanings

- "Publish to the issue tracker" means create a GitHub issue with `gh issue create -R PsychedelicShayna/neodeck --title "..." --body-file <path>`.
- "Fetch the relevant ticket" means read the issue, comments, and labels with `gh issue view <number> -R PsychedelicShayna/neodeck --comments`.

## Labels and participation

Use [triage-labels.md](triage-labels.md) for composable kind, relationship,
priority, estimates, specification, actor state, review state, and merge
eligibility. [Triage](triage.md) owns the two-pass process and daily
reconciliation. Publication authority remains in [issue-funnel.md](issue-funnel.md).

## Sizing

Difficulty measures how hard the work is, independently of time and priority.
Frame measures duration. Fresh agent estimates concern a competent AI agent
with tools and subagents; preserve human estimates as authored.

### Difficulty

Difficulty is in `[0, 1]`: `0` is a mechanical one-line change; `1` is the hardest
work the project will attempt. Weigh complexity, uncertainty, regression risk, and
cross-repo coordination. Preserve the estimator and source of an estimate.

| Label | Range |
| --- | --- |
| `difficulty: 0.000-0.125` | `0.000 ≤ d < 0.125` |
| `difficulty: 0.125-0.250` | `0.125 ≤ d < 0.250` |
| `difficulty: 0.250-0.375` | `0.250 ≤ d < 0.375` |
| `difficulty: 0.375-0.500` | `0.375 ≤ d < 0.500` |
| `difficulty: 0.500-0.625` | `0.500 ≤ d < 0.625` |
| `difficulty: 0.625-0.750` | `0.625 ≤ d < 0.750` |
| `difficulty: 0.750-0.875` | `0.750 ≤ d < 0.875` |
| `difficulty: 0.875-1.000` | `0.875 ≤ d ≤ 1.000` |

Exact-float difficulty title prefixes (`0.35 - …`) are an existing convention.
Preserve evidenced values and map to their band (`0.12` is in the first;
`0.13` in the second). This policy neither mandates nor removes the prefix.

### Frame

Available units are `frame: hours`, `frame: days`, `frame: weeks`, `frame: months`,
and `frame: years`. For a fresh agent-authored estimate, normalize down exactly
one step: years → months → weeks → days → hours, with hours as the floor.
Human-authored estimates remain unchanged.

Record the estimator, original unit, and normalization in the issue body or an
attributed comment. Later triage reuses that provenance rather than shrinking
the same estimate again. Keep existing estimates unless evidence supports a
change. Larger frames may warrant splitting into independently deliverable work.

## Upstream requests (NeoPi)

NPI deck consumes NeoPi (`PsychedelicShayna/neopi`) in-process. When the deck
needs a new SDK export, RPC field, memory API, or event shape, the deck lead
files a NeoPi issue and the NeoPi-side agent implements it there.

- That issue is the contract: exact field names, capabilities, types, and events.
- Amend the contract by commenting on the NeoPi issue before merging a change to it.
- The consuming deck issue links the NeoPi contract in its body. The NeoPi-side issue uses `downstream` for its consuming-project relationship; no dedicated dependency label is needed on the deck issue.
- Unresolved disagreements go to the operator. Cross-project ADRs and product decisions remain owned by their project.

## Wayfinding operations

Preserve `/wayfinder` maps and their children using native sub-issue links
(or a task list plus `Part of #<map>` when unavailable), without map-specific
labels. Relationship evidence belongs in links and bodies.

Dependencies use GitHub's native issue dependencies: POST
`repos/PsychedelicShayna/neodeck/issues/<child>/dependencies/blocked_by` with
`issue_id=<blocker database id>` (not the issue number or node ID). If native
dependencies are unavailable, use `Blocked by: #<n>` in the body. Check the
blocker's completion/promotion evidence rather than assuming a closed record
proves implementation. Claim the first unclaimed, unblocked child in map order
with `agent: started` (or `human: started` for an ITL claim); record the responsible
session/PR and optionally assign the GitHub account. Resolve with an answer
comment, close only when authorized, and append the answer link to the map's
Decisions-so-far.
