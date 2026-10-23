# NPI deck

NeoDeck is [NeoPi](https://github.com/PsychedelicShayna/neopi)'s orchestration and integration frontend; [NeoCode](https://github.com/PsychedelicShayna/neocode) is its graphical frontend.

Repository and issue tracker: `PsychedelicShayna/neodeck`. Active upstream:
`Shreyans13/omp-deck` (`upstream` remote). Original `bjb2/omp-deck` credits
in README/CHANGELOG record historical provenance, not the active upstream.

## Read before acting

- Read `README.md` for project context and runtime layout; it is not agent policy.
- Read `CONTEXT.md` for repository/tracker vocabulary before interpreting work.
- Read `docs/agents/policy.md` before branches, commits, GitHub posts, PRs, or merges; `docs/agents/` is the home for agent policy and mechanics.
- Before requesting optional review or answering findings, read `docs/agents/pr-review-bots.md` for reviewer mechanics; `docs/agents/policy.md` owns nightly delivery.

## Fork maintenance

Before adding fork behavior or integrating upstream, read
`docs/agents/fork-maintenance.md` for placement and compatibility rules.
Before synchronizing a release, follow `docs/agents/upstream-sync.md`.
Repository slug changes do not rename package scopes, environment variables,
installed paths, launchers, or services. The default/live snapshot remains
`~/.local/share/npi-deck`, served by `npi-deck.service`. Nightly installation
is authorized under `docs/agents/policy.md`; default/live promotion is separate.

## Agent skills

### Issue tracker

GitHub Issues on `PsychedelicShayna/neodeck`; always target it explicitly because
fork discovery can resolve to the upstream parent. Read
`docs/agents/issue-tracker.md` for commands, sizing, NeoPi contracts, and wayfinding.

### Triage

Read `docs/agents/triage.md` before classifying, claiming, reconciling, or closing
issues and PRs; `docs/agents/triage-labels.md` defines the composable vocabulary.

### Issue Funnel

Before publishing or amending Captain specifications, read
`docs/agents/issue-funnel.md` for publication ownership and deduplication.

### Domain docs

Single-context: root `CONTEXT.md` and decisions under `docs/agents/adr/` when present. Read
`docs/agents/domain.md` before domain exploration.

## Sizing work

Read `docs/agents/issue-tracker.md#sizing` for independent difficulty/frame
estimates, provenance, and one-time agent-frame normalization. Preserve
human-authored estimates and existing evidenced title prefixes.
