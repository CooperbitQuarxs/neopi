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

Record proposals in a persistent working file with URL, observed `updatedAt`,
labels, proposed additions/removals, evidence and uncertainty. Re-read changed
records before applying state deltas. The initial reconciliation includes open
and closed issues/PRs; subsequent at-least-daily passes cover all open work and
changed closed/merged records. An assignment may separate proposal from application;
apply only within its authority. The [publication seat](issue-funnel.md) has its
own queue and amendment boundaries. No scheduler is installed by these docs.
