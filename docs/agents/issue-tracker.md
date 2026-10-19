# Issue tracker: GitHub

Issues and specs live in GitHub Issues at `PsychedelicShayna/neopi`. Use the
`gh` CLI from this clone so it resolves the repository from `origin`.

## Mechanics

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --comments`, including labels.
- List: `gh issue list --state <state> --json number,title,body,labels,comments` with the filters the task requires.
- Apply or remove verified labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Posting, identity, branches and merge authority follow the workspace policy in `~/repos/AGENTS.md`.

"Publish to the issue tracker" means create a GitHub issue. "Fetch the
relevant ticket" includes its body, comments, labels and relevant linked
implementation. PRs are evidence and a triage surface, not a substitute
request backlog.

## Reconciliation

Reconcile at least daily. The initial pass includes open and closed issues
and PRs; subsequent passes cover open work and changed closed/merged records.
This requirement does not imply a scheduler is already installed.

Use the dedicated triage role when the owner configures it. Until then use
the built-in `commit` role (`@commit`), resolved at runtime, for a bounded
triage assignment. Do not freeze a model slug or launch a redundant swarm.

1. Read the complete issue or PR body, relevant comments, current labels,
   acceptance criteria and linked implementation. Check existing ownership
   before proposing another implementer.
2. Distinguish merged PRs from closed unmerged PRs, partial implementation
   from completed scope, and an author's claim from verified gate evidence.
   When evaluating review status, read PR review bodies as well as inline
   comments, threads and issue comments.
3. Apply the settled compositional meanings in `triage-labels.md`. Leave
   unfinished lifecycle/reviewer/risk choices open. Do not infer authority
   from a `spec`, a legacy readiness label or an actor's completed part.
4. Produce a proposal containing the record URL, observed labels, proposed
   additions/removals, state recommendation, source evidence and uncertainty.
   Separate estimates and hypotheses from observed facts.
5. An authorized integration owner reviews and applies supported changes.
   Preserve unresolved choices as questions or assessment work, not invented
   certainty. Follow up on tangible changed behavior, not unrelated upstream
   defects.

Type, priority, estimates, relationships and readiness are independent
dimensions. Do not reduce an issue to only the inherited readiness labels,
require obsolete effort tiers, or silently remove repository-specific labels.
The publication seat's contract remains `issue-funnel.md`.

## Duplicates and completion

Before closing a duplicate, verify the same underlying request, preserve
useful unique context in an attributed comment on the canonical issue, and
cross-link both records. Title similarity alone is not proof. An entangled
alternative is not automatically a duplicate.

Close completed work only when the full acceptance contract is met, or when
the owner explicitly decides to close it. Cite the completing merge and
verification. A partial PR does not close an umbrella; an explicit promotion
condition must still be satisfied.

GitHub's automatic `Fixes #N` closure normally follows the default branch,
so an implementation merged into `nightly` can leave its issue open. Check
the actual contract: manually close a completed issue with evidence rather
than assuming either that every nightly merge closes it or that every issue
must wait for promotion.
