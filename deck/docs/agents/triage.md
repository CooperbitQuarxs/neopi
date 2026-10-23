# Triage

Triage turns intake into an evidence-backed description of work, relationships,
and participation. The vocabulary is in [triage-labels.md](triage-labels.md),
tracker commands in [issue-tracker.md](issue-tracker.md), and publication
ownership in [issue-funnel.md](issue-funnel.md). This is iteration 1; open
policy questions remain recorded rather than silently decided.

## Intake and two passes

Every issue template applies `needs-triage`. When taking the triage batch,
replace it with `triage: started` (proposed spelling, deployed this iteration).
This records classification in progress, not implementation ownership.

1. Read each incoming issue in full, including relevant comments, acceptance,
   linked PRs, and implementation evidence. Record a provisional classification
   in a local file so it survives context loss. Include issue URL, observed
   update time, current labels, proposed additions/removals, rationale and source
   links, estimator/original unit, unresolved questions, and closure proposal.
   Keep these first-pass labels provisional until the comparison pass finishes.
2. Read and compare against **all open issues**, including already-triaged ones,
   to find duplicates, incompatible alternatives, and dependencies. Use the
   paginated inventory in [tracker conventions](issue-tracker.md#conventions),
   not the first 30 results from `gh issue list -R PsychedelicShayna/neodeck`. Fetch upstream with
   the same pagination/filter using `Shreyans13/omp-deck`; inspect
   linked NeoPi contract issues separately. Compare bodies and discussion, not
   titles alone. Check linked PRs' actual merge state and full acceptance; a
   closed unmerged PR or an author's completion claim is not implementation proof.
3. Re-read any record changed since the provisional snapshot. Apply only the
   verified additions/removals to its live labels, preserving unrelated labels.
   Remove `triage: started` when classification is complete. Use `needs-info`
   with the exact missing information when blocked, or return to `needs-triage`
   if classification remains incomplete. Publication and closure actions stay
   within the current assignment's authority.

Reconcile open issues **and PRs at least daily**, not only at intake. Read stale
claims, linked merged PRs, review receipts and replies, promotion state, and
remaining acceptance. Correct stale labels from evidence. The built-in commit
role (`@commit`, resolved at runtime) performs reconciliation until a dedicated
triage role is chosen; this policy does not install a scheduler or webhook.
Each pass also checks open issues against merged PR bodies (`Fixes`/`Closes`) and upstream changelog entries since the last sync, marking work fixed by our own merges `agent: finished` and commenting with the PR and nightly SHA as evidence, closing only when the existing acceptance and promotion requirements allow, and commenting "fixed upstream in <version>, lands with the next sync" on those fixed upstream.
Daily triage adds `upstream` to a promotion proposal only when that proposal actually carries a `sync/` merge; the promotion workflow does not detect or apply upstream involvement.
Daily, after `git fetch --prune origin`, list orphan topic branches from `git branch -r --no-merged origin/nightly`, excluding remote HEAD/default/integration refs and branches with an open PR (match the paginated open-PR inventory by head repository and branch).

## Duplicate reconciliation

Compare both requests and their discussion. Append an attributed update to the
canonical issue containing the duplicate's useful new context and its source
link. Cross-link both records, explain the canonical choice, then label and
close the duplicate when authorized. Preserve variations instead of losing
information merely because the headline repeats.

## Incompatible alternatives

Apply `entangled` to every incompatible alternative and add reciprocal links.
Present the differences and concise pros/cons so the owner can choose A, B, or C.
An ordinary dependency is not entanglement. `duplicate` and `entangled` may
compose when variants address the same request but cannot coexist. Wait for the
owner's choice; remove the winner's entanglement and close the others with the
recorded decision when authorized. Entangled issues are not pending pickup.

## Estimates

Assign one priority, one difficulty band, and one frame when enough evidence is
available. Difficulty is independent of duration and priority; preserve the
existing eight bands and their descriptions in [Sizing](issue-tracker.md#sizing).
NeoDeck's exact-float title prefix is an existing convention; this rollout
neither mandates it nor removes it.

For an **agent** estimate, lower the original frame exactly one unit:
`years → months`, `months → weeks`, `weeks → days`, `days → hours`,
`hours → hours`. Record estimator, original unit, resulting label, and that
normalization was applied in the issue body or an attributed comment. Later
triage reuses that record; it never lowers the same estimate twice. Human
estimates are unchanged. Missing provenance calls for investigation, not an
assumed second adjustment.

## Actor states and authorization

- `agent: pending` means fully specified work can be picked up out of the loop
  (OTL). Replace it with `agent: started` when claiming the implementation.
- `human: pending` means an in-the-loop (ITL) session is needed; the human may
  work through an agent. Replace it with `human: started` when claimed.
- `started` is a claim warning others not to duplicate work, not a heartbeat or
  assertion of continuous activity. Record the responsible session/PR because
  several agents may share a GitHub account.
- Replace an actor's `started` with `finished` when that actor's agreed part is
  complete. Human participation can finish while follow-up work remains;
  agent implementation can finish while promotion is still pending.
- Keep at most one state per actor. The two actors' states may coexist when
  their parts differ. `finished` is not `mergeable`, and labels alone do not
  authorize implementation. Record a handoff before releasing an unfinished claim.

Neither `needs-info` nor `entangled` issues are pending pickup. Name the blocker
and remove pending labels until the required information or decision arrives.
An `idea` remains undecided; `spec` records a specification, not permission.
An authorized `experiment` uses an `experimental/` branch only; entering
`nightly` or `main` requires a separate owner decision.

## Optional review and PR state

[policy.md](policy.md#nightly-delivery) owns nightly delivery and optional review
selection. Triage does not assign a reviewer by default. Review and `mergeable`
labels describe evidence or confidence; none gates nightly.
[pr-review-bots.md](pr-review-bots.md) supplies mechanics when review is chosen.
Changes to the base do not invalidate evidence or require refreshed labels.

## Closure

Verify **every acceptance criterion**, not merely the existence of a linked PR.
NeoDeck fixes stay open until the complete behavior is promoted to `main`.
A merge into `nightly` does not auto-close the issue or warrant manual closure;
record the implementation and promotion proof before closing. Keep umbrella
issues open while any required child remains incomplete. A new follow-up does
not invalidate correctly completed work.

`stale: identical` needs proof the request is implemented essentially as
specified and still follows the promotion condition. `stale: similar` leaves
an issue open for the remaining differences. `invalid` and `wontfix` explain
closure: state respectively the wrong repository, missing required format or
information, policy violation, or decision not to pursue the work. Use
`needs-info` for a live request that can proceed once named information arrives.
Automatic repair/reopening of malformed submissions is not implemented.
