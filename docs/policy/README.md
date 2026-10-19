# Repository policy

The workspace policy in `~/repos/AGENTS.md` governs branches, commits,
signing, pull requests, merging, labels, and GitHub posting. This file holds
only the values that policy leaves to the repository. Nothing here adds a
confirmation step.

## Branches

| Role | Branch | Local checkout | Ships as |
| --- | --- | --- | --- |
| Default (promoted) | `neopi` | `~/repos/neopi` | `npi` at `~/.local/bin/npi` |
| Integration | `nightly` | `~/repos/neopi-nightly` (worktree) | `npi-nightly` at `~/.local/lib/npi-nightly/npi`, wrapper `~/.local/bin/npi-nightly`, fish alias `ni` |

- Topic branches: `git fetch origin && git worktree add ~/repos/neopi-wt-<slug> -b <type>/<slug> origin/nightly`.
- PRs target `nightly`. `hotfix/` PRs target `neopi` and are followed by a PR merging `neopi` back into `nightly`.
- Upstream (`can1357/oh-my-pi`) releases merge on `sync/<date>` into `nightly`; procedure in `docs/agents/upstream-sync.md`.

## Merging

- Merge commits only (`gh pr merge --merge`). Subject: `Merge PR #<number>: <conventional PR subject> (@<author>)`.
- The authoring agent merges its own PR into `nightly` once the workspace gates pass. Review bots (`docs/agents/pr-review-bots.md`) are advisory and are requested at the agent's discretion.
- Contributor heads (any author other than the owner) are never executed on the owner's machine; see `docs/agents/pr-review-bots.md` › Running PR code.

## Promotion

`nightly` is promoted into `neopi` weekly by the `promote-nightly` workflow
(`.github/workflows/promote-nightly.yml`): it opens a `sync/promote-<date>`
PR from `nightly` into `neopi` and merges it when checks pass. The owner may
also run it by hand with `gh workflow run promote-nightly.yml`.

## Labels

- Labels compose across type, priority, estimates, relationships and specification presence. The settled vocabulary and unresolved decisions are in `docs/agents/triage-labels.md`; do not treat the interim guide as the finished setup policy.
- Priority names remain `priority: p0` … `priority: p3`. Grounded `difficulty:*` bands and `frame:*` estimates replace compulsory new `effort:*` assignment; preserve estimate provenance and review historical labels before removal.
- `idea`, `experiment` and `spec` distinguish undecided possibilities, experimental approaches and specification presence. None alone authorizes implementation. `experiment` replaces `experimental idea`.
- Existing readiness names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) remain usable during the participation-state design. Final human/agent lifecycle spellings are not chosen.
- Current PR-state names remain `needs-review`, `ready-for-merge`, `review-stalled`. The target `mergeable` name requires a coordinated workspace-policy/consumer cutover before the live label is renamed.
- Current `upstream-sync` remains until its consumers, including the promotion workflow, are migrated to target `upstream` (substantive upstream involvement). `baseline` removal is unresolved; do not equate every base defect with upstream.
- Deselected labels such as `rpc`, `t3c-npi`, `npi-deck`, `codex-review` and `sentinel-review-requested` are not new triage assignments. Preserve existing associations until reviewed cutover; this is not permission to delete them or ignore an existing required review.
- Reconcile the tracker at least daily using `docs/agents/issue-tracker.md`. Use the runtime `commit` role until the owner configures a dedicated triage role; proposals require evidence and review before application. No scheduler is installed by this documentation change.

## Where the rest lives

| Topic | File |
| --- | --- |
| Code conventions, package layout, testing filter | `AGENTS.md` |
| Fork placement and compatibility checks | `docs/agents/fork-maintenance.md` |
| Upstream sync procedure | `docs/agents/upstream-sync.md` |
| Review-bot mechanics | `docs/agents/pr-review-bots.md` |
| Issue tracker, funnel, triage labels | `docs/agents/issue-tracker.md`, `docs/agents/issue-funnel.md`, `docs/agents/triage-labels.md` |
