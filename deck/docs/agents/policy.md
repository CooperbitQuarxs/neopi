# Repository policy

This repository carries its branches, commit, review, tracker, and merge policy
so a fresh clone has the instructions it needs. `AGENTS.md` routes to these
mechanics; `README.md` describes the project. This is an iterative policy, not
a setup-skill implementation.

## Branches

| Role | Branch | Ships as |
| --- | --- | --- |
| Default (promoted) | `main` | Installed snapshot `~/.local/share/npi-deck`, served by `npi-deck.service` |
| Integration | `nightly` | Built, installed, and launch-checked after each merge or batch; separate from default/live promotion |

Start topic work from a freshly fetched remote integration branch in its own
worktree:

```sh
git fetch origin
git worktree add ../neodeck-wt-<slug> -b <type>/<slug> origin/nightly
```

Types: `fix/`, `feat/`, `docs/`, `ci/`, `experimental/`, `chore/`, `refactor/`,
`test/`, `sync/<date>`, and necessary `hotfix/`. Ordinary PRs target `nightly`.
Hotfixes target `main` and require an immediate PR merging `main` back into
`nightly`; only the owner merges into `main`. Experiments remain on
`experimental/` branches unless the owner separately decides to integrate them.
Agents leave default/integration branch history to merged PRs; no direct
commits, pushes, resets, rebases, or force-pushes there. Preserve local drift
and unrelated work rather than committing it as part of a topic.

Active upstream is `Shreyans13/omp-deck` (`upstream` remote). Original
`bjb2/omp-deck` credits are historical provenance. Follow
[upstream-sync.md](upstream-sync.md) for releases on `sync/<date>` into
`nightly` and [fork-maintenance.md](fork-maintenance.md) for compatibility.
Keep fork contracts when integrating upstream. Repository slug changes do not
rename `@npi-deck/*`, `NPI_DECK_*`, state/install paths, launchers, or services.

## Commits

Commit small logical changes with a Conventional Commit headline:
`type(scope): imperative summary`, at most 72 characters. The prose body says
what changed, why, and verification actually performed. Put `Fixes #<n>` on its
own line only when the change completes the issue. Include both actual-model
trailers:

```text
Model: <provider>/<model-id>
Co-authored-by: <Model Name> <noreply@provider-domain>
```

Explicitly select the agent SSH signing key for each commit:

```sh
git commit -S/home/shayna/.ssh/id_ed25519_github_signing_agents.pub -m '<headline>' -m '<body and trailers>'
git verify-commit HEAD
```

Push only verifiable signatures. Keep published fixups as new commits; preserve
history rather than amending or force-pushing. Commit intentional files only,
with no secrets or unrelated generated output. Remove the worktree and local
topic branch after its PR is merged or closed.

## Pull requests and posting

Use one PR per issue and the exact headings/order/checklist in
`.github/PULL_REQUEST_TEMPLATE.md`; check only true items and explain skipped
checks beside unchecked boxes. Title uses the commit's Conventional Commit
form. Declare `Depends on #<n>` for dependencies and merge them first.

A topic branch with commits gets a PR in the same turn it is declared done;
every opened PR merges, with a revert PR if the change turns out wrong.
[Daily triage](triage.md#intake-and-two-passes) lists orphan branches.

Every issue and PR gets a kind, priority where assessed, and relevant state from
[triage-labels.md](triage-labels.md). Intake uses `needs-triage`. Review labels
are optional descriptive evidence, never nightly gates. Follow
[triage.md](triage.md) for reconciliation rather than treating labels as authority.

Every GitHub comment, issue, review reply, and PR body begins:

```text
> [!NOTE]
> <Model Name> on behalf of PsychedelicShayna
```

The authoring agent may push its topic, post on its PR, file baseline issues,
apply the policy's labels, and merge its PR into integration under Nightly delivery.
Other PRs, repository settings/rulesets/protection, and posting elsewhere stay
outside that authority. Changes to workflows go through their own PR. Contributor
heads are read-only on the owner's machine; use the owner-head rule in
[pr-review-bots.md](pr-review-bots.md#running-pr-code).

## Nightly delivery

The owner uses nightly and supplies feedback; CI and review bots do not decide
whether a change stays. Merge at about 80% confidence that the change works;
lower is acceptable. Record confidence and suspected PR-caused check failures
in the merge note. Fix failures in a follow-up if they matter.

The authoring agent merges into `nightly` unless the assignment names another
integrator. Merge commits only: `gh pr merge -R PsychedelicShayna/neodeck --merge`, with subject
`Merge PR #<number>: <conventional PR subject> (@<author>)`. Resolve actual
conflicts by merging the base into the topic, never rebasing or refreshing.
A changed base never invalidates review, confidence, or other evidence.
Regressions are reverted through a PR; every opened PR merges or is reverted.

After each merge or batch, build and install nightly and check that it launches.
"It does not start" is the blocking bar. Use the native setup and launcher
commands in [installation](../install.md), preserving pinned NeoPi/native-addon
contracts and existing runtime identities. This authorizes nightly installation,
not promotion or replacement/restart of the separate default/live snapshot.
A proof session may hold the destination-scoped runtime install lock for at most
ten minutes, releasing it as soon as proof ends. Use the lock from
[NeoPi #386](https://github.com/PsychedelicShayna/neopi/pull/386), with the same
`NPI_DEST` for `hold`, `status`, `release` and installation; expired holds do not
defer delivery. Record the installed revision and launch result.

Review bots are optional double-checkers: no default request, at most one round
only for a large-blast-radius change that could make the harness unusable.
Fix what matters to merging; note or ignore the rest. Mechanics live in
[pr-review-bots.md](pr-review-bots.md). Owner-discretion bug hunts inspect
nightly after landing and are not merge gates.

CI and tests never block nightly. Delegate any watching to a cheap poller and
keep moving; do not wait for review, CI, or exact-head receipts. Review and
`mergeable` labels are descriptive only. Checks for promotion remain the
owner's decision.

Workflow changes go through PRs. For a workflow triggered only after landing,
keep it single-purpose, delegate watching its first eligible run, and revert
through a PR if needed. Agents leave rulesets and branch protection unchanged.

## Promotion

`.github/workflows/promote-nightly.yml` runs monthly and on `workflow_dispatch`
to **open the promotion PR only**, with `human: pending`; the owner merges
`nightly` into `main`. Automation does not merge into the default branch.

Scheduled/dispatch execution requires the workflow on the default branch.
The Captain performs the first promotion after it lands on `nightly`; watch the
first eligible run after it reaches `main`. Default/live installation and
service changes remain the owner's decision; nightly delivery is authorized above.

NeoDeck fixes stay open until the complete acceptance is promoted to `main`;
merging a linked PR to `nightly` alone does not close them. Closure mechanics
are in [triage.md](triage.md#closure).

## Releases

The existing CI workflow publishes a stable GitHub release after each push to
`main`, a unique prerelease after each push to `nightly`, and a stable release
from a selected ref on `workflow_dispatch`. The Ubuntu matrix builder supplies
the source-plus-web archive; PRs do not publish. Releases and tags are
append-only: never delete or overwrite an existing release, its assets or tag.
The package-derived tag formats, dispatch commands and archive setup are in
[README.md › Releases](../../README.md#releases). These tags replace the
previous proposed date-based fork convention; existing upstream tags remain
unchanged. Release publication is separate from promotion and live deployment;
[installation](../install.md) owns runtime setup.

## Mechanics

| When | Read |
| --- | --- |
| Classifying, claiming, reconciling, or closing issues | [triage.md](triage.md), [triage-labels.md](triage-labels.md) |
| GitHub commands, estimates, NeoPi contracts, wayfinding | [issue-tracker.md](issue-tracker.md) |
| Publishing Captain specifications | [issue-funnel.md](issue-funnel.md) |
| Requesting optional review or answering findings | [pr-review-bots.md](pr-review-bots.md) |
| Exploring terminology or architectural decisions | Root `CONTEXT.md`, [domain.md](domain.md), `docs/agents/adr/` when present |
| Fork placement or synchronizing upstream | [fork-maintenance.md](fork-maintenance.md), [upstream-sync.md](upstream-sync.md) |
