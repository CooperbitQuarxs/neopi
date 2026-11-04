# Design philosophy: agents are peers, roles are templates

The owner's direction for NeoPi and the wider Neo ecosystem (NeoCore, NeoCode, NeoDeck, NeoProxy). The full version, with sources, the Chronicler case study and the counterargument to "harnesses don't matter", lives in the private `PsychedelicShayna/neocore` repository under `docs/philosophy/`. This page is the self-contained summary for work in this repository. It is a direction, not an implementation plan: the owner authorizes building.

## Why not

The owner's shorthand is **why not?** Katie describes the contrast as asking restrictions, rather than capabilities, to justify themselves. A justified restriction is a named property of an agent, not a fixed role baked into the harness. This states NeoPi's intended direction, not a verified survey of all competing products.

## The model

- **An agent is a model inside a harness.** There is one kind. Primary, sub-agent, advisor, chronicler, scout and warden are **templates**: an agent plus restrictions. Remove the restrictions and it is indistinguishable from the primary.
- **Complexity comes from constraint.** Specialized agents emerge by restricting a free agent, the way particles trade freedom to form atoms and molecules.
- **Agents are peers.** "Spawned by" is metadata, not ownership; an agent outlives the agent or interface that started it.
- **NeoCore daemon: tmux for agents.** A headless server hosts agents; the TUI, NeoCode, NeoDeck, a phone or a shell command attach to and detach from them. An agent needs an interface only when a human wants to watch or steer it.
- **What the harness can configure, an agent can reach,** within its restrictions, including other agents' prompts, tools and lifecycles.
- **New agent kinds come from conversation.** Iterate on a live agent, save it as a template, and parameterize model and effort ("spawn a Luna warden at extra-high"). No new harness feature or settings section is needed.

## What a template sets

| Group | Properties |
|---|---|
| Input | What wakes it (human, prompt, another agent's transcript, timer, event); synthetic input and its schedule; where user-role messages may come from; channels it reads |
| Powers | System prompt, tools, filesystem scope or sandbox, model/role/effort, which agents it may see, message, spawn, kill or reconfigure, access to its own metadata |
| Output | Its spawner, another agent's queue, IRC, disk, a telemetry surface, or nowhere |
| Lifetime | Configurable completion, wake and stop conditions; persistence independent of the spawner. Exact expiry and resource policy remain open. |

Illustrative configurations, not fixed defaults: an advisor could read another agent's transcript and send advice; a chronicler could read that transcript and write beats to disk; a warden could inspect fleet state and message agents. Their permissions, wake conditions and lifetimes remain configurable.

## Rules for work in this repository

- **Templates before species.** Before adding a role, mode or settings section for a new kind of agent, express it as properties on the existing agent; a new hard-coded species needs a stated reason in its issue.
- **Named restrictions.** A feature that limits what an agent can see or do exposes the limit as a property with a default and a reason.
- **Interfaces are clients.** Lifecycle state belongs to the agent and the daemon, not to the interface that launched it; keep the session engine runnable without the TUI.
- **Additive to upstream.** Plain `npi` keeps upstream's process-owns-its-agent behavior; daemon mode sits beside it (see [fork-maintenance.md](fork-maintenance.md)).

## Engineering suggestions, not owner-selected policy

Katie proposed daemon-owned scheduling/liveness, leases or budgets for cleanup, capability attenuation, and an advisor/Chronicler template-parity exercise. Saturn proposed restrictive defaults for shared office deployments. Those remain proposals; the schema, authority matrix, deployment defaults and acceptance criteria need owner decisions. They must not be silently treated as requirements of this philosophy.
