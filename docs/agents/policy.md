# Repository policy

This repository carries its operating policy for any agent or fresh clone.
[AGENTS.md](../../AGENTS.md) routes code conventions; [CONTEXT.md](../../CONTEXT.md)
defines repository terms. This iteration remains open to owner-directed revision.

## Branches and worktrees

| Role | Branch | Channel |
| --- | --- | --- |
| Default, promoted | `neopi` | `npi` at `~/.local/bin/npi` |
| Integration | `nightly` | `npi-nightly` at `~/.local/lib/npi-nightly/npi` |

Create each topic from fetched remote integration in its own worktree:
`git fetch origin && git worktree add ../neopi-wt-<slug> -b <type>/<slug> origin/nightly`.
Use `fix/`, `feat/`, `docs/`, `ci/`, `chore/`, `refactor/`, `test/`,
`experimental/`, or `sync/<date>`. Integration and default branches change through
merge-commit PRs, not direct commits, resets, rebases or force-pushes. Preserve
unexpected local work before repairing any checkout drift.

PRs target `nightly`. Necessary `hotfix/` PRs target `neopi`, require the owner's
merge, and are immediately followed by a PR merging `neopi` back to `nightly`.
Upstream `can1357/oh-my-pi` releases merge through `sync/<date>` PRs into `nightly`;
read [upstream-sync.md](upstream-sync.md) before integrating them. Preserve fork
behavior; upstream parity alone does not authorize removing it.
`experiment` work stays on `experimental/` branches until an owner decision
permits integration. Remove the worktree and local topic branch after merge or
closure, preserving any unrelated work first.

## Commits and identity

Commit small logical changes. Use Conventional Commits headlines,
`type(scope): imperative summary`, at most 72 characters. The prose body explains
what changed, why, and exactly what verification ran. Put `Fixes #N` on its own
line when applicable. Every commit includes the actual executing identity:

```text
Model: <provider>/<model-id>
Co-authored-by: <Model Name> <noreply@<provider-domain>>
```

Sign each commit explicitly with the agent key, without changing signing config:
`git commit -S/home/shayna/.ssh/id_ed25519_github_signing_agents.pub -m "<headline>" -m "<body and trailers>"`.
Run `git verify-commit HEAD`; only verifiable commits are pushed. Review fixes
are new commits; preserve pushed history. Keep secrets, unintended generated
files and unrelated work out of commits.

Every agent-authored GitHub comment, review reply or issue opens with:

```text
> [!NOTE]
> <Model Name> on behalf of PsychedelicShayna
```

## Pull requests and labels

One issue per PR; link an existing issue instead of inventing one for submitted
work. PR titles use the primary commit's Conventional Commits form. Use
`.github/PULL_REQUEST_TEMPLATE.md` with its headings, order and checklist; check
only true boxes and explain unchecked checks. Record dependencies as
`Depends on #N` and wait for them before merging.

Use [triage-labels.md](triage-labels.md) for kind, priority, relationships,
participation, review and merge eligibility. Every issue/PR has a supported kind
and appropriate state; unresolved intake gets `needs-triage`. Every PR carries
`review: codex`. [triage.md](triage.md) owns the two-pass triage and daily
reconciliation process; [issue-tracker.md](issue-tracker.md) owns CLI mechanics.

## Review and checks

A clean CODE round on the final head and a factual answer to every finding are
required before merge, including docs and policy changes. Read
[pr-review-bots.md](pr-review-bots.md) for triggers, current-head receipts, state
labels and unresolved-round handling. Request no new security passes. Existing
security findings still need disposition. Contributor heads are read-only on the
owner's machine; the owner-head safety rule is in that review guide.

Finish relevant local verification before requesting review and report only
checks actually run. Follow `AGENTS.md` for package-local commands. Classify a
failing check from evidence: head-only is the PR's defect; identical base/head
failure is a baseline defect; passes on both establish a flake. File a `baseline`
issue with runs and output before accepting a red baseline check or rerunning a
flake. An unavailable local check needs concrete evidence, not hopeful reruns.
A CI fix affecting every PR stays in a single-purpose PR. Workflow changes that
cannot exercise their changed event path before merge are watched on their first
integration run and reverted through a PR on failure.

## Merge authority

`mergeable` means full acceptance, required checks green (or a documented
identical baseline failure), clean final-head CODE receipt, all findings answered,
and branch current with the base. It is independent of actor-finished labels and
GitHub's no-conflicts flag. The authoring agent merges its own PR into `nightly`
when these criteria pass, except when the assignment reserves integration to
another agent. Open PRs awaiting a decision or dependency say so in a comment.
Policy-file owner approval mechanics remain an open decision; do not invent a
new approval mechanism in this iteration.

Use merge commits: `gh pr merge --merge`, with subject
`Merge PR #<number>: <conventional PR subject> (@<author>)`. Resolve topic conflicts
by merging the base into the topic, preserving both histories. Re-check dependent
open PRs after every merge. Revert a broken integration through a PR. The owner
alone merges promotions and other PRs into `neopi`. Agents leave repository
rulesets, branch protection and settings unchanged.

The author may push its topic commits, post and answer on its own PR, file
baseline issues, maintain the documented labels, and merge its own integration
PR under these gates. Other authors' PRs remain read-only unless the owner
explicitly delegates them.

## Promotion and issue completion

The agreed promotion policy is monthly PR creation plus `workflow_dispatch`:
`promote-nightly.yml` opens `sync/promote-<date>` from `nightly` to `neopi`, labelled
`human: pending`; the owner merges. Workflow automation opens the request and
leaves the promotion decision to the owner.

A merge into `nightly` is not automatic issue closure. Verify every acceptance
criterion before manually closing completed work. Issues requiring the shipped
`npi` channel remain open until promotion to `neopi`; other fully accepted nightly
work may close with evidence. [triage.md](triage.md) defines partial, duplicate,
invalid and declined dispositions.

## Policy map

| Task | Read |
| --- | --- |
| Code, testing, build/install | `AGENTS.md` |
| Project context, not instructions | `README.md` |
| Tracker terms and package contexts | `CONTEXT.md`, `CONTEXT-MAP.md` |
| Triage and vocabulary | `docs/agents/triage.md`, `docs/agents/triage-labels.md` |
| Publication seat | `docs/agents/issue-funnel.md` |
| Review receipts and bot identity | `docs/agents/pr-review-bots.md` |
| Fork placement and upstream integration | `docs/agents/fork-maintenance.md`, `docs/agents/upstream-sync.md` |
| Architectural decisions | `docs/agents/adr/` |

Portable repository skills live in `.agents/skills/`; NeoPi discovers that path
through its agents provider. Harness-specific commands and tool probes remain in
`.omp/`. The babysit-pr procedure is undergoing a separate owner rewrite; where
its older procedure differs, use this policy and the review guide for the gate.
