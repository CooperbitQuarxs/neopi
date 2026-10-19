# 0001: Merge only when CI and every review bot's latest round are clean

Status: accepted (2026-09-28; manual-request context restored 2026-10-19).

## Decision

Merge only after CI and the latest required reviewer round on the final head
are clean, with every finding answered. Rounds are requested manually; a push
alone does not start one. The current configured requirement is a Codex CODE
round, including documentation and policy changes. Request no new security
passes. Existing findings, including already-posted security findings, still
need factual disposition. [pr-review-bots.md](../pr-review-bots.md) owns current
receipt signals, severity handling and lifecycle; [policy.md](../policy.md)
owns merge authority. This restores the accepted merge gate rather than treating
review as optional.

## Context

On PR #113, CODE review of `2ff9cc8a93` returned clean at 02:53Z, the PR merged
at 02:57Z, and a separately requested security review posted a finding at 03:01Z.
That history demonstrated that a green partial response is not evidence that
all required work has finished. The original process requested CODE and security
passes. The owner's current decision requires final-head CODE review only and
starts no new security passes; preserve disposition of existing findings rather
than silently ignoring them.

PRs #95 and #99 established factual replies before thread resolution as an
audit trail. A resolved thread without an answer loses that record. A new push
also invalidates the old head's receipt, even when CI is green.

## Considered options

- CI alone: rejected; it does not establish reviewer completion or disposition.
- Fix every minor observation in the same PR: rejected; independent baseline
  defects and justified lower-severity deferrals need explicit tracking, not
  unrelated scope growth. Serious in-scope findings remain blockers.
- Trust a bot's built-in gate alone: rejected; its threshold and completion
  signals do not replace repository policy.

## Consequences

The author requests the required round on the final head, answers every finding,
and checks the receipt before merge. A timeout is not an automatic waiver;
unresolved loops are reported under the review guide. New reviewers require a
configured token/login/trigger mapping and explicit completion evidence. The
owner retains default-branch promotion authority.
