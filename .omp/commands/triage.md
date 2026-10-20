# Triage command

Classify and reconcile GitHub issues using `docs/agents/triage.md`. Read
`docs/agents/policy.md` for authority, `docs/agents/triage-labels.md` for the
vocabulary, and `docs/agents/issue-tracker.md` for CLI mechanics before acting.

## Arguments

`$ARGUMENTS`: optional `--days <n>`, default `7`, limits **new intake candidates**
to open issues created in that window. It does not limit the second pass's
comparison set or replace the at-least-daily reconciliation of all open issues
and PRs. Without a candidate match, report that result; preserve the full
comparison requirement for candidates that do exist.

## Execute

1. Read candidate bodies, comments and linked work completely; paginate results.
2. Claim assessment with `triage: started`; persist provisional labels and
   observed record timestamps in a working file outside tracked source.
3. Complete the manual's second pass against every open local issue and relevant
   `can1357/oh-my-pi` tracker records. Reconcile duplicates and identify entangled
   choices before assigning actor eligibility.
4. Apply supported label deltas within the assignment's authority after re-reading
   changed records. Preserve estimate provenance; normalize fresh agent frames
   once. Use existing label definitions rather than creating new vocabulary.
5. Report URLs, applied deltas, duplicate/entangled links, remaining information
   or owner decisions, and the ledger path. Count processed, changed and held
   records without calling held records complete.
