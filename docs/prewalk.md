# Prewalk

Prewalk is a one-shot handoff from a planning model to an execution model after planning reaches implementation. The planner can inspect the repository, create a todo list, and begin the change before the execution model continues the same session.

Prewalk is off by default. With no crew settings, it plans on the active model and executes on the `@smol` role. Plan mode remains a separate read-only overlay.

## Enable prewalk

Enable prewalk persistently in the global config:

```bash
omp config set prewalk.enabled true
```

The equivalent YAML in `~/.omp/agent/config.yml` or a project `.omp/config.yml` is:

```yaml
prewalk:
  enabled: true
```

## Configure the crews

Settings > Model > Prewalk exposes the enable switch, both selectors, and ordered fallback lists. The same keys work in the active profile's `config.yml`, project `.omp/config.yml`, a `--config` overlay, or session settings through `cfg://`. Project and session values do not require changes to global model roles.

```yaml
prewalk:
  enabled: true
  planner: "@slow:high"
  plannerFallbacks: ["anthropic/claude-sonnet-4-6:high"]
  execution: "@smol:low"
  executionFallbacks: ["openai/gpt-5-mini:low"]
```

Selectors accept role aliases and `provider/model[:effort]`. An empty planner keeps the active model. Each phase tries its primary selector's role chain, then its ordered fallback selectors, skipping disabled or unauthenticated models. These are launch-time selection fallbacks, not request-retry chains. If either configured crew is unavailable, startup warns and leaves prewalk unarmed without changing the normal starting model.

Before the first request, the CLI shows `Prewalk crew: plan provider/model:effort → execute provider/model:effort`. Extension-backed planners resolve after provider registration, like execution targets. `--prewalk-into` replaces the execution primary selector for that startup session; execution fallbacks still apply.

## Session overrides

The configured setting arms new sessions, not resumed/imported sessions. Explicit session flags can arm either:

| Flag | Effect |
| --- | --- |
| `--prewalk` | Arm prewalk for the new session. |
| `--no-prewalk` | Leave prewalk disabled for the startup session, even when `prewalk.enabled` is `true`. `/new` still follows `prewalk.enabled`. |
| `--prewalk-into <model-or-role>` | Arm prewalk and override `prewalk.execution` for the startup session. |

For example:

```bash
omp --prewalk
omp --prewalk-into @smol
omp --prewalk-into openai/gpt-5-mini
```

At startup, NeoPi resolves both crews with the normal model-role and model-matching rules. If no usable crew remains, it prints a warning and starts with prewalk unarmed.

`--no-prewalk` cannot be combined with `--prewalk` or `--prewalk-into`. An explicit `--prewalk-into @default` resolves against the default role from before `--model` overrides it.

`/new` starts a fresh cycle using `prewalk.enabled` and the current crew settings, rather than inheriting a consumed handoff or the previous todo gate. Startup flags apply only to the startup session. A configured planner takes precedence; an empty planner restores the previous planning model and thinking level after a handoff unless a later selection replaced them. If restoration fails, `/new` warns and stays on the current model. Resuming an existing session does not automatically re-arm prewalk.

Any model or thinking-level change made after the handoff counts as a replacement, including the switches plan mode makes on entry and exit. Automatic retry fallback, fallback restoration, and context promotion do not; if the session is back on the handoff model and thinking level when you run `/new`, it still restores the planning model.

## Handoff trigger

An armed prewalk injects a planning nudge. When the `todo` tool is active, any successful `todo` call—including the read-only `view` operation—opens the handoff gate. Without an active `todo` tool, the gate is already open.

OMP switches at the completed assistant-turn boundary containing the first eligible `edit` or `write` result, after persisting that turn's assistant message and tool results. Unlike the todo gate, the edit/write trigger does not require a successful result.

Calls to other tools do not trigger the handoff. A read-only `xd://` device request routed through `write`, such as LSP navigation, also does not count; only device operations classified as workspace writes or execution count.

The switch is one-shot: after the handoff, prewalk disarms itself, removes the planning nudge, and steers the execution model with the written planning text, successful todo output, and implementation checklist. It also records a versioned `prewalk-handoff` session object containing the brief, planner, execution model, efforts, and timestamp. The delivered brief remains in rebuilt session context. Hidden reasoning is never copied into the brief. Model-role assignments do not change. A same-model handoff can still change thinking; when both model and thinking configuration already match, prewalk disarms without switching.

## Arm from an active session

In a top-level session, turning `prewalk.enabled` on selects the configured planner and arms the execution handoff; turning it off cancels a pending handoff without changing the active model. Editing a crew selector while enabled starts a fresh configured arm. These settings do not enable subagent prewalk by themselves.

Run these slash commands without restarting OMP:

```text
/prewalk
/prewalk restart
/prewalk off
```

`/prewalk` arms the configured execution crew, selecting the configured planner when present. With empty planning settings it keeps the active model.

`/prewalk off` cancels a pending handoff and clears its planning steering without changing the active model, saved configuration, or already-delivered continuation history. It is safe to run when already off or after a handoff; it does not switch back to the planning model. Cancellation applies only to the current session: `/new` re-arms prewalk when the configured setting is enabled.

`/prewalk restart` selects the configured planner and re-arms the execution crew. When no planner is configured, it retains the existing `@default` restart behavior. Both crews resolve when the command runs without altering role assignments.

An existing matching arm is preserved. If restart would replace a different armed target, it is rejected before changing the active model. `/prewalk off` followed by `/prewalk` selects a fresh crew.

## Subagent prewalk

Task subagents have separate prewalk controls: agent frontmatter, `task.prewalk`, and per-agent `task.agentPrewalk` overrides. See [Task agent discovery](./task-agent-discovery.md) for their precedence and target selection.

Enabled task prewalks use these same planner/execution selectors and fallbacks. An explicit agent prewalk string or per-agent target overrides the execution primary selector. An empty planner preserves normal task model routing. Persistent-seat downgrade-after-no-write behavior is separate and unchanged.
