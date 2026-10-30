# Issue tracker: GitHub

Issues and specs live in `PsychedelicShayna/neopi` GitHub Issues. Use `gh` from
this clone so `origin` resolves the repository. Read [policy.md](policy.md) for
posting identity, branches and authority; read [triage.md](triage.md) before
intake classification, relationship reconciliation, actor transitions or closure.
The label vocabulary is [triage-labels.md](triage-labels.md).

## CLI mechanics

- Create: `gh issue create --title "..." --body-file <path> --label needs-triage`.
- Read the full record: `gh issue view <number> --comments` including labels.
- List candidates: `gh issue list --state open --limit 1000 --json number,title,body,labels,comments,updatedAt`; paginate through the API if the result reaches the limit.
- Apply verified deltas: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- Read upstream: `gh issue list --repo can1357/oh-my-pi --state all --search "<relevant terms>"`, followed by complete matching records and related PRs.

"Publish to the issue tracker" means create a GitHub issue. "Fetch the relevant
ticket" includes body, comments, labels, acceptance and linked implementation.
PRs are evidence and a triage surface, not a substitute request backlog. Read PR
review bodies as well as inline threads and issue comments when reconciling state.

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

## Filing and reconciliation

Record proposals in a persistent working file with URL, observed `updatedAt`,
labels, proposed additions/removals, evidence and uncertainty. Re-read changed
records before applying state deltas. The initial reconciliation includes open
and closed issues/PRs; subsequent at-least-daily passes cover all open work and
changed closed/merged records. Each pass also checks open issues against merged
PR bodies (`Fixes`/`Closes`) and upstream changelog entries since the last sync,
closing those fixed by our own merges with the PR and nightly SHA as evidence,
and commenting "fixed upstream in <version>, lands with the next sync" on those
fixed upstream. An assignment may separate proposal from application; apply only
within its authority. The [publication seat](issue-funnel.md) has its own queue
and amendment boundaries. No scheduler is installed by these docs.
