# Triage manual

Use this procedure for intake and at-least-daily reconciliation of open issues
and PRs in `PsychedelicShayna/neopi`. Read [policy.md](policy.md) before changing
tracker records and [triage-labels.md](triage-labels.md) for the vocabulary.
This manual defines the process; no scheduler or webhook is installed by it.

## Intake and two passes

1. Begin intake with `needs-triage`. Issue templates apply it automatically;
   blank/API submissions may arrive unlabeled, so the intake actor adds it when
   discovered, including during daily reconciliation. Blank filing stays enabled;
   automatic labeling outside templates is an open automation item. Read the
   whole body, comments, acceptance criteria, current labels and linked work.
   Reconcile existing
   claims before assigning another implementer. Replace `needs-triage` with
   `triage: started` while assessment is in progress; this spelling is an
   iteration-1 proposal, not a promise that classification is complete.
2. First pass: record provisional labels in a persistent working file outside
   the tracked source tree. Include each record URL, observed `updatedAt`,
   current labels, proposed additions/removals, rationale, missing information,
   estimator and original time unit. Read every intake candidate before the
   relationship pass. Keep uncertainty explicit rather than guessing readiness.
3. Second pass: compare the candidates with **all open local issues**, including
   already-triaged ones, for duplicates, dependencies and incompatible choices.
   Read relevant linked PRs and compare with the `can1357/oh-my-pi` issue tracker
   and related upstream PRs. Record matching URLs or the searches made; upstream
   involvement includes compatibility, divergence and foreseeable conflicts,
   not only release synchronization.
4. Re-read any record changed since the proposal's observed `updatedAt` before
   applying its state. Apply supported additions/removals as a delta to the live
   labels, preserving unrelated facts. Remove `triage: started` when both passes
   and their dispositions are recorded. Restore `needs-triage` if assessment is
   unfinished; use `needs-info` when the missing information is named.

Completion means the entire candidate set has both passes, relationships and
estimate provenance recorded, and each issue has an evidence-backed disposition.
A sparse report needs its comments read, not a classification from its title.

## Duplicates and incompatible alternatives

For a duplicate, compare both requests and select the canonical issue by its
scope and useful existing discussion, not title similarity alone. Append an
attributed update to the canonical issue preserving useful new evidence and
variation from the duplicate. Identify the contributor and source issue, link
both records, then label the duplicate `duplicate` and close it with the
canonical link. Preserve the original request and its authorship.

Use `entangled` for alternatives that cannot coexist, even when they are not
duplicates. Add reciprocal links to every member, state the incompatible choice,
and present concise differences and pros/cons so the owner can choose A/B/C.
`duplicate` and `entangled` can coexist. Await the owner's choice; then retain
the selected issue, remove its entanglement once resolved, and close the rejected
alternatives with the decision and cross-links. Ordinary dependencies remain
linked dependencies, not entanglement.

## Classification and estimates

Compose kind, relationships, priority, difficulty, frame and specification
presence. `idea` preserves an undecided possibility; `spec` identifies an
implementation specification. Neither alone authorizes implementation.
Documentation covers user- and agent-facing docs, README and changelog; reconcile
those surfaces with the behavior they describe. `experiment` permits work only
on an `experimental/` branch; merging to `nightly` or `neopi` requires a separate
owner decision.

Use one applicable `priority: p0`–`p3`, one grounded difficulty band and one time
frame. Difficulty is independent of elapsed time; justify it from the required
work and dependencies. If an estimate is not yet grounded, record what is
missing rather than inventing one.

For an **agent-authored fresh estimate**, lower the unit exactly once:

| Original unit | Applied frame |
| --- | --- |
| years | `frame: months` |
| months | `frame: weeks` |
| weeks | `frame: days` |
| days | `frame: hours` |
| hours | `frame: hours` |

Record estimator identity, original unit, applied unit and normalization status
in the issue's attributed triage note or linked ledger. A later pass reuses that
provenance and never lowers an already-normalized estimate again. Human-authored
estimates remain unchanged, including `frame: years`.

## Participation and claims

- OTL means out-of-the-loop work: `agent: pending` → `agent: started` →
  `agent: finished`. Pending requires a sufficient contract and authorization
  for unattended pickup. Replace pending with started when an agent claims it.
- ITL means a human participates in the session, not that the human writes the
  code: `human: pending` → `human: started` → `human: finished`. Started records
  the human's claim. Finished records completion of the required participation.
- Keep only one state per actor. Different actors' states may coexist when
  they describe distinct parts. Started is a claim, not continuous activity or
  a heartbeat; another actor checks the claim before duplicating work.
- Finished means that actor's part is done, not that the whole issue is accepted
  or the PR is `mergeable`. Review and CI can still require changes.
- `entangled` and `needs-info` issues are not pending work for either actor.
  Record the blocker and existing claim, remove pending labels, and reassess
  eligibility once the choice or information arrives.

## Assign review requirements

Default: assign `review: codex` to every PR and to issues expected to produce a
PR, including documentation and workflow changes. The PR author re-checks the
review policy against the actual diff before requesting a round. A hypothetical
conditional security policy is not permission to start security passes: this
repository currently requires CODE review only. The token/login/trigger mapping,
current-head receipts and review-state lifecycle live in
[pr-review-bots.md](pr-review-bots.md). Role completion never substitutes for that
gate or for merge authority.

## Closure and daily reconciliation

Verify the full acceptance contract against implementation and verification
evidence before closing completed work. Distinguish merged PRs from closed
unmerged PRs, partial implementation from whole acceptance, and claims from
observed behavior. A nightly merge does not automatically close its issue:
GitHub's closing keywords take effect on `neopi`. When acceptance does not
require promotion, a complete nightly implementation may be closed manually
with evidence; an issue requiring the shipped `npi` channel remains open until
promotion into `neopi`. `stale: identical` marks verified equivalent
implementation; `stale: similar` keeps remaining differences explicit and open.

Use `invalid` as a closure reason for the wrong repository, missing required
information/format, or policy violations; state the concrete defect. Use
`needs-info` instead when the report can progress after named information arrives.
The exact boundary remains open for refinement. `wontfix` records a decision not
to work on a request; close with the decision and reason. Automatic repair or
reopening of malformed reports is not part of this process.

At least daily, reconcile all open issues and PRs, not only new intake. Read
bodies, review bodies, inline threads and comments; check linked merged work,
remaining acceptance, claims, estimate provenance, review receipts on the actual
head and merge criteria. Apply supported deltas; preserve unresolved choices.
Daily, after fetching origin, list orphan topic branches from `git branch -r --no-merged origin/nightly`, excluding remote HEAD/default/integration refs and branches with an open PR (match the paginated open-PR inventory by head repository and branch).
Use the runtime `commit` role for a bounded triage assignment until a dedicated
triage role is configured. [issue-tracker.md](issue-tracker.md) has CLI mechanics;
[issue-funnel.md](issue-funnel.md) governs the publication seat.
