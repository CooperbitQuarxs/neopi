# Maintaining fork behavior across upstream updates

## Placement of new behavior

Before adding fork behavior, locate the upstream owner and inspect existing extension hooks and shared utilities. Prefer an extension when its supported hooks can express the complete behavior, including cancellation, persistence, and session changes.

Keep substantial fork-specific logic in focused modules or extension directories. When a core change is required, make the integration point narrow and explicit. Extend the existing owner when it must enforce a lifecycle or protocol invariant. A new file alone does not provide isolation if it copies upstream internals or depends on their incidental order.

For each core integration, record the missing extension capability and the observable contract that requires the core change in the PR or associated design document. Test that contract through its consumer. Use shared utilities rather than duplicating their implementations. Avoid unrelated refactoring of upstream-owned code in the same change.

Examples in this fork:

- Personas, loadouts, and REPL mode started as extensions and moved into `packages/coding-agent` once their UX needed the composer, fullscreen overlays, and per-turn prompt preparation. Their state and command logic live in `src/neopi/`; the integration points are narrow: `AgentSession` applies the session persona while preparing a turn, and the input controller routes REPL cells. Atomic settings changes remain the responsibility of Settings and AgentSession.
- Additional eval backends from third-party extensions use the registration API; execution ownership, cancellation, and transcript persistence remain session responsibilities.
- Advisor severity policy can live in its own module, but queue delivery and interruption guarantees require agent-loop and session integration.

## Integrating an upstream release

Pin the source fork commit, upstream release commit, and relevant open PR heads before resolving conflicts. Use a separate worktree for integration when the active checkout contains unrelated work or an open feature branch. Preserve a recovery ref.

Review upstream changes to every fork integration point, including files Git merged automatically. For each fork behavior, determine whether upstream preserves it, replaces it fully, overlaps it partly, or conflicts with it. A clean textual merge is not evidence of behavioral compatibility.

Keep open PRs separate until their contracts have been compared with the new upstream behavior. If upstream replaces part of a PR, retain the remaining requirement and adapt its tests; do not infer redundancy from similar changelog wording. Report the recommended merge order and unresolved behavior decisions before promoting an integration that depends on those decisions.

Validate both upstream regressions and fork contracts at the affected boundaries. Record source changes, failed or unavailable checks, and actual test results separately. Apply the binary installation rules in AGENTS.md when reaching the installation stage.

## Command and Settings provenance

`packages/coding-agent/src/config/entry-provenance.json` is the command/setting
classification source. `packages/tui/src/theme/ui-entry-provenance.json` carries
the existing hotkey, role and status-segment annotations. Both use one lookup and
the same tier vocabulary in `packages/tui/src/theme/provenance.ts`.

- **Moon:** a NeoPi-only addition absent from the latest published stable release.
- **Purple star:** a NeoPi-only addition present in that release's source commit.
- **Gold, silver, bronze stars:** additions in the newest, previous and third
  synced upstream ranges. Older upstream entries are unmarked.

Pin `stableRelease.tag` and its peeled commit to GitHub's latest published
non-prerelease, not the potentially newer `neopi` branch head. Update the stable
and nightly fork lists from that released inventory. For an upstream sync,
prepend one `upstream` range with its version, exclusive previous commit,
inclusive release commit and newly introduced IDs; existing ranges age
automatically without moving every item between color lists. Retain only three
visible tiers. A fork feature adopted upstream takes the upstream tier.

Audit the actual built-in command registry (including aliases and bundled
extension commands) and `orderedSettings()`/`createSettingsHost()` inventories.
Include generated and conditionally hidden setting rows; configuration-only
settings may remain in the dataset even though the panel does not display them.
Do not assign fork origin to arbitrary third-party commands by name. Bundled
extensions provide their own provenance from the shared registry at registration.
Display marks never change command identifiers, completion values or type icons.

Marker colors are optional theme tokens: `provenancePurple`, `provenanceGold`,
`provenanceSilver`, and `provenanceBronze`. Older/custom themes inherit light or
dark defaults and may override each token. Terminal rows and native spans paint
markers independently of the surrounding label; plain Markdown/native-label
transport uses the matching glyph without embedding terminal ANSI sequences.

