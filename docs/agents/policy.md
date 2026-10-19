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

A branch with commits gets a PR in the same turn it is declared done, and that
PR merges. Every opened PR is merged; if wrong, revert it rather than leaving
it open. [Daily triage](triage.md#closure-and-daily-reconciliation) lists orphans.

Use [triage-labels.md](triage-labels.md) for kind, priority, relationships,
participation and descriptive review state. Every issue/PR has a supported kind
and appropriate state; unresolved intake gets `needs-triage`. Review is optional.
[triage.md](triage.md) owns two-pass triage and daily reconciliation;
[issue-tracker.md](issue-tracker.md) owns CLI mechanics.

## Nightly delivery

`nightly` exists to be merged into, built and installed so the owner can use
the change and give feedback. The owner is the tester; her feedback, not CI or
a review bot, decides whether a change stays.

- Merge at about 80% integrator confidence; lower is acceptable. Record confidence
  in the merge note. A PR is a unit of tangible change the owner can feel when
  she runs the build.
- After every merge or batch, build and install `npi-nightly` using `AGENTS.md`,
  then check that it launches. "It does not start" is the bar that blocks.
- A proof session may hold the destination-scoped install lock for at most ten
  minutes; use the same `NPI_DEST` with `scripts/install-lock.sh hold <minutes> <holder> [reason]`,
  `status`, `release` and `install.sh`, and release as soon as proof ends.
  Expired holds do not defer installation. The lock implementation landed in
  [#386](https://github.com/PsychedelicShayna/neopi/pull/386).
- Base changes never invalidate anything. Merge the base into a topic only to
  resolve an actual conflict, never to refresh and never by rebasing.
- Never block or wait: hand any CI/review watching to a cheap poller agent and
  keep moving the next PR.

## Review and checks

Review bots are optional double-checkers, not merge gates. Do not request a
round by default. At most one round is allowed, only for a large-blast-radius
change that could make the harness unusable if wrong. Fix what that round finds
that matters to merging; note or ignore the rest. [pr-review-bots.md](pr-review-bots.md)
owns bot identity and optional request mechanics. Bug hunts run against `nightly`
at the owner's discretion, using parallel agents over recently merged PRs;
their findings do not gate merges.

CI and test suites never block a merge into `nightly`. A failing check is
information: note suspected PR-caused failures in the merge note and fix in a
follow-up if it matters. Report only checks actually run. Checks still matter
for promotion into `neopi`, which the owner decides.

## Merge authority

Agents merge into `nightly` under the delivery rules above, unless the assignment
reserves integration to another agent. `mergeable` records readiness under those
rules, not CI or review approval. Merge order is the agents' job.

Use merge commits: `gh pr merge --merge`, with subject
`Merge PR #<number>: <conventional PR subject> (@<author>)`. Resolve real conflicts
by merging the base into the topic; preserve both histories. Revert a broken
integration through a PR. The owner alone merges promotions and `hotfix/` PRs
into `neopi`. Leave repository rulesets, branch protection and settings unchanged.

Workflow changes exercised only after landing stay single-purpose: delegate
watching their first integration run and revert through a PR on failure.
Contributor heads remain read-only on the owner's machine; the owner-head
safety rule lives in [pr-review-bots.md](pr-review-bots.md#running-pr-code).

The author may push its topic commits, post on its own PR, file issues, maintain
supported labels and merge its integration PR. Other authors' PRs remain
read-only unless the owner explicitly delegates them.

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
`.omp/`. The Nightly delivery rules take precedence over any older gate text
in the babysit-pr skill. Leave the skill file untouched.
