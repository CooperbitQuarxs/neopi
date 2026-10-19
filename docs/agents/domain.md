# Domain docs

OMP uses a multi-context domain layout.

## Before exploring

- Read root `CONTEXT-MAP.md` when it exists. It points to the context documents relevant to each package or subsystem.
- Read root `CONTEXT.md` for repository/tracker terms and relevant `docs/agents/adr/` entries for system-wide decisions.
- Read the selected package or crate's `CONTEXT.md` and context-specific ADRs routed from `docs/agents/adr/` when present.
- If a named file does not exist, proceed silently. Domain-modeling workflows create these files lazily when the vocabulary or decision exists.

## Layout

- `CONTEXT-MAP.md`: routes topics to context documents.
- `CONTEXT.md`: repository and tracker vocabulary.
- `docs/agents/adr/`: agent-facing architectural decisions, including context-specific decisions.
- `packages/<context>/CONTEXT.md`: TypeScript package or subsystem vocabulary.
- `crates/<context>/CONTEXT.md`: Rust crate vocabulary.

Use terms from the relevant `CONTEXT.md` in issues, proposals, hypotheses, and test names. Surface conflicts with an existing ADR instead of silently overriding it.
