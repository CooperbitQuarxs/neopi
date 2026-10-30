# Triage labels

Iteration 1 of the repository vocabulary. Labels describe independent facts;
apply the supported combination rather than inventing a compound label.
[Triage](triage.md) owns the procedure, [tracker sizing](issue-tracker.md#sizing)
owns estimate provenance, and [review mechanics](pr-review-bots.md) owns review
receipts. Label availability does not authorize work.

## Kind

| Label | Meaning |
| --- | --- |
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | User- or agent-facing docs, README or changelog |
| `accessibility` | Barrier affecting people with disabilities |
| `idea` | An undecided possibility; not a spec, not authorized work |
| `experiment` | Tried on an `experimental/` branch; never merged to nightly or default without an owner decision |
| `spec` | Is or contains an implementation specification |
| `hotfix` | Urgent targeted fix to the default branch |

## Relationship and disposition

| Label | Meaning |
| --- | --- |
| `upstream` | Upstream is involved: sync, compatibility, conflict avoidance or divergence |
| `downstream` | Needed by a project that consumes this one |
| `duplicate` | Same request as another issue; context merged into the canonical one |
| `entangled` | Incompatible alternatives; the owner chooses one, the rest close |
| `baseline` | Pre-existing defect found on the base during review; kept this iteration |
| `invalid` | Closed: wrong repo, missing required information or format, or policy violation |
| `wontfix` | Closed: will not be worked on |
| `stale: identical` | Already implemented essentially as specified |
| `stale: similar` | Implemented differently; open for the remaining differences |

NeoPi contract dependencies are body links, not a special NeoDeck label.
`downstream` belongs on the NeoPi issue when NeoDeck needs its capability.
Wayfinding maps retain native sub-issue links and dependency relationships.

## Priority and estimates

| Label | Meaning |
| --- | --- |
| `priority: p0` | Blocks current work or handles an active incident |
| `priority: p1` | High value or prerequisite for several issues |
| `priority: p2` | Useful planned work |
| `priority: p3` | Backlog or opportunistic work |
| `difficulty: 0.000-0.125` | Agent difficulty in [0.000, 0.125); exact float is the title prefix |
| `difficulty: 0.125-0.250` | Agent difficulty in [0.125, 0.250); exact float is the title prefix |
| `difficulty: 0.250-0.375` | Agent difficulty in [0.250, 0.375); exact float is the title prefix |
| `difficulty: 0.375-0.500` | Agent difficulty in [0.375, 0.500); exact float is the title prefix |
| `difficulty: 0.500-0.625` | Agent difficulty in [0.500, 0.625); exact float is the title prefix |
| `difficulty: 0.625-0.750` | Agent difficulty in [0.625, 0.750); exact float is the title prefix |
| `difficulty: 0.750-0.875` | Agent difficulty in [0.750, 0.875); exact float is the title prefix |
| `difficulty: 0.875-1.000` | Agent difficulty in [0.875, 1.000]; exact float is the title prefix |
| `frame: hours` | Estimated time frame: hours (agent estimates lowered one unit) |
| `frame: days` | Estimated time frame: days (agent estimates lowered one unit) |
| `frame: weeks` | Estimated time frame: weeks (agent estimates lowered one unit) |
| `frame: months` | Estimated time frame: months (agent estimates lowered one unit) |
| `frame: years` | Estimated time frame: years (agent estimates lowered one unit) |

Keep the difficulty band descriptions as recorded. Existing title prefixes are
preserved; this policy neither requires adding nor removes them. Agent frames
are lowered exactly once, with hours as the floor; human frames are unchanged.

## Triage and actor state

| Label | Meaning |
| --- | --- |
| `needs-triage` | Not yet triaged |
| `triage: started` *(proposal)* | Triage in progress; labels are provisional |
| `needs-info` | Cannot proceed until the named information arrives |
| `agent: pending` | Ready for an out-of-the-loop (OTL) agent to pick up |
| `agent: started` | An agent has claimed this; do not duplicate the work |
| `agent: finished` | The agent's part is done; not necessarily mergeable |
| `human: pending` | Needs an in-the-loop (ITL) session with a human |
| `human: started` | A human has claimed the in-the-loop part |
| `human: finished` | The human's in-the-loop part is done |

`started` is a claim, not a heartbeat. Human means human-in-the-loop, not a
requirement that a human write the code. Proposal spellings are in use this
iteration and remain revisable.

## Review and merge

| Label | Meaning |
| --- | --- |
| `review: codex` | Optional selection of Codex as a double-checker |
| `review: requested (codex)` | A recorded Codex round was requested |
| `review: open (codex)` | Recorded Codex findings remain open |
| `review: closed (codex)` | The recorded round is complete and addressed as useful |
| `review: stalled (codex)` | Describes missing/failed review evidence, never a nightly blocker |
| `mergeable` | Optional integrator confidence signal, not a CI/review gate or merge authority |

Only `codex` is configured; [pr-review-bots.md](pr-review-bots.md) maps its
login and trigger. These labels are optional descriptive evidence. Record the
round's SHA where useful; a new head or changed base does not invalidate it
or demand a new round, mechanical comparison, or label refresh.

## Composition

- Kind, relationship, priority, difficulty, frame, specification, actor state,
  review state, and merge eligibility describe separate axes. Examples:
  `upstream` + `bug`, `downstream` + `enhancement`, or `upstream` + `experiment`.
- Multiple applicable kinds may coexist. An `idea` need not be a `spec`, and
  neither alone means ready for implementation.
- One priority, difficulty band, and frame per sufficiently assessed issue;
  one state per actor and one descriptive state per selected reviewer.
- `duplicate` + `entangled` is valid for incompatible variants. `needs-info`
  and `entangled` exclude pending pickup until unblocked.
- `experiment` may compose with `idea` or `bug`; its branch restriction excludes
  ordinary nightly/default merge eligibility without a separate owner decision.
- Actor completion and review labels do not confer merge authority. Nightly
  delivery follows [policy.md](policy.md#nightly-delivery), not label gates.
- A base defect need not originate upstream: keep `baseline` distinct from
  `upstream`. Legacy reviewer-request labels do not impose nightly gates.

## Open decisions

Recorded, not implemented: retiring `baseline` (the proposed bug + upstream
composition loses fork-local base defects); upstream-conflict-potential and
user-disruption axes; a dedicated label for blocking questions; resource
allocation; a squash/rebase exception; owner approval mechanism for policy
files; setup skill and HTML questionnaire; Magi tribunal reviewer; automated
triage runner/webhook; GitHub Projects/Discussions reporting. These questions
are not implicit permission to add labels, automation, reviewers, or gates.
