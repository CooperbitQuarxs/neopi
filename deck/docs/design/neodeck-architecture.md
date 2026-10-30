# NeoDeck: the new deck

The owner's order of 2026-10-21: design NeoDeck from scratch, with the old
OMP Deck as reference only and NeoPi's web language (`/stats`, `/collab`,
`/share`) as the one fixed thing. Required reading behind this document:
`neocore/docs/vision/2026-10-13-captain-vision.md`,
`neocore/docs/vision/2026-10-20-neo-vision-verbatim.md`, the fragments beside
them, and her OMP Deck vision diary. This file is the design: what the deck
is, how it is organised, and the decisions she can reject.

## 1. What the deck is

A cockpit for an office whose workers are people, agents and routines, on a
shared machine. One place everyone goes. The inbox is the front door; the
board is the work; threads are how you talk to agents; agents are equals and
every restriction on one is visible; graphs (what we know, what we do) are a
first-class workshop, not a corner of the scheduler; GitHub governs code and
is wired in, not bolted on; every account has quotas and can see its usage;
NeoPi is the engine and NeoProxy is how its providers reach the office.

The old deck was "a GUI for the harness": thirteen pages, three columns on
every page with two toggles to hide them, a sidebar that listed features
instead of work, a modal for a task, a planned page for every idea. The new
deck has nine places, each with one job, and detail opens beside the list
instead of on top of it.

## 2. Information architecture

Sidebar, grouped as `/stats` groups its pages. Hotkeys are `G` then the
letter.

```
Office      Inbox (i)      capture · triage · promote; the Today strip
            Board (b)      one board, every project, cards with evidence
            Threads (t)    talk to agents; several primaries in one thread
Agents      Agents (a)     everything alive: roster, templates, the judge log
            Studio (u)     graphs you build: flows, routers, classifiers, map
Library     Knowledge (k)  the wiki, with the map one keystroke away
            Skills (s)     installed skills and the marketplace, one page
Engine      GitHub (g)     repos, issues, PRs, the implementation wheel
            Usage (y)      your quota, your pools, what you spent
            Models (m)     effort rules, roles and inference providers
            Settings (,)   engine, accounts, integrations, appearance
```

There is no Home. The Inbox carries the "what needs me" strip at its top, so
signing in lands you where work starts. (Reject: restore a Home page.)

`/login` gates everything. `/legacy/*` keeps the old deck reachable until the
new one covers every feature it had (Settings › Legacy deck).

## 3. The shell

The chassis follows NeoProxy: a 52 px glass topbar with the
`NeoPi / deck / Page` lockup, grouped sidebar at 224 px with 32 px rows,
and one inset panel. The hamburger hides the entire sidebar on desktop;
the choice persists in this browser. Below 900 px it opens a navigation
overlay instead, with Escape, keyboard focus containment and focus return.
Opening the mobile menu does not change the saved desktop choice.

- The topbar's right side holds engine status, dictation, theme and the
  signed-in account menu. Status and identity are quiet inline controls,
  not a row of pills. View-local controls stay inside each page.
- The sidebar footer teaches navigation with `G` then a letter and a few
  examples. Presence counts belong to the pages that explain them, rather
  than repeating preview counts throughout the shell.

Pages are one of three shapes, never a fourth:

1. **List + drawer** (Board, Agents, GitHub, Skills, Usage): page header,
   stat strip, filter bar, dense sortable table or grid; a row opens a right
   drawer (560 px) with a pinned footer. Nothing floats.
2. **Master–detail** (Inbox, Threads, Knowledge): a 300 px list column with
   its own search at the top, the detail fills the rest. Both columns are
   fixed regions inside the panel.
3. **Canvas** (Studio): a 56 px toolbar, the canvas, a 320 px inspector.

## 4. Pages

### Inbox (the front door)

```
┌ Today ──────────────────────────────────────────────────────────────────┐
│ 3 need you · 2 agents working · 1 PR waiting for review · 4 unread      │
├──────────────┬──────────────────────────────────────────────────────────┤
│ search       │ Sitemap lastmod                        capture · 2h ago  │
│ Unread 4     │ ───────────────────────────────────────────────────────  │
│ ● Sitemap…   │ body (markdown)                                          │
│ ● Docs search│                                                          │
│ ○ Theme…     │ Proposed: ticket → Board › atlas › backlog   [Accept] [Edit]│
│ …            │ Promote to: card · issue · thread · note                 │
│ ─ Done ─     │ History: captured by lin · classified by judge           │
├──────────────┴──────────────────────────────────────────────────────────┤
│ Capture: [ title…                               ] [kind ▾] [Capture ⏎]  │
└──────────────────────────────────────────────────────────────────────────┘
```

Capture is a fixed bar at the bottom of the page, always there, always the
same height. An item shows the classifier's proposal (kind, destination,
project) as one line you accept or edit; promoting writes the card, issue,
thread or note and leaves a receipt in the item's history. Shared and private
inboxes are a segmented switch in the list head.

### Board

One board, every project, `Project` filter in the bar. Columns are the task
states; a card shows its project, origin glyph (inbox / GitHub / thread),
assignee (person or agent, with the live dot), and a one-line last-evidence
("tests pass · 4m"). A card opens a drawer: title, body, the timeline of
what happened (assigned → agent run → PR opened → review), linked issue/PR,
actions (assign to agent, open thread, archive). Columns are edited in the
same drawer shape. Flow templates ("instantiable kanban flows") appear as a
`Flow` chip on a card and are built in Studio.

### Threads

```
┌ list 300 ──────┬ thread ─────────────────────────────────────────────────┐
│ search         │ Fix anchor links           atlas · 2 agents · $0.14     │
│ Needs you 1    │ [Main ● sonnet] [Reviewer ● opus] [+ agent]  ← targets │
│ ● Fix anchors  │                                                         │
│ Working 2      │  you      The anchors 404 after the heading rename…     │
│ ◌ Build slower │  Main     Three anchors pointed at #install…           │
│ ◌ Release notes│           ▸ read docs/getting-started.md · 1.2s         │
│ Settled        │  Reviewer One of them is in the sidebar too.            │
│ · Dark theme   │                                                         │
│ · Flaky test   ├─────────────────────────────────────────────────────────┤
│                │ → Main  [ message…                               ] ⏎ 🎤│
│                │ neoproxy/default ▾ · ctrl+] next agent · 3 lines fixed  │
└────────────────┴─────────────────────────────────────────────────────────┘
```

The list settles: threads that need you first, working ones dimmed grey,
settled ones quiet. A thread hosts agents; each has a colour swatch and the
composer says who it is addressed to; `Ctrl+]` cycles, "all" broadcasts.
Tool calls are one-line rows folded under the prose by default. The
composer is a fixed 3-line region with its bar; it never grows. Spawning an
agent picks a template (Worker, Advisor, Chronicler, Judge, Warden, blank)
and shows the restrictions it carries as chips you can remove.

### Agents

Everything alive on the deck, across threads, cards and routines: one table
(name, template, model, where it is working, state: needs you / working /
parked / idle, tokens, cost, since). Below it, templates as cards: each a
named set of restrictions (visibility, lifecycle, spawn, model, prompt) with
the chips shown, not described. The right side of the page is the **judge
log**: the watcher's event feed across every session, newest first, with
"stuck", "needs you", "stopped unsanctioned fleet" as toned rows.

### Studio

The promoted canvas. Left list of graphs grouped by kind; one toolbar
(name, kind, enabled, Canvas / Source / Runs, Run now, Save); one canvas;
one inspector (320 px, the graph's settings when nothing is selected, the
node's fields when one is). The node vocabulary changes with the kind; the
editor does not.

| Kind | What it is | Nodes |
| --- | --- | --- |
| Flow | scheduled routines (today's `/api/routines`; the existing builder, embedded) | the builder's steps |
| Pipeline | request pipelines: event → inference → transform → route → output | `event.*`, `infer.request`, `infer.tidy`, `agent.spawn`, `transform.*`, `route.classify` / `route.if` / `route.fanout`, `out.*` |
| Router | a NeoProxy virtual model's chain, drawn left to right | `router.entry`, `router.stage` (model, accounts, draw, per-account share, cap per user/window), edges mean demote, `router.terminal` (limit / queue / passthrough) |
| Classifier | one question to a small model; one output per label | `cls.input`, `cls.ask`, `cls.rule`, `cls.output` |
| Board flow | a kanban template cards flow through | `bf.column`, `bf.assign`, `bf.gate`, `bf.notify`, `bf.done` |
| Map | the knowledge map, read-only here | — |

Source is TOML for the new kinds (the owner wants TOML), YAML for flows
until routines migrate; it is a view, not a different page. Runs render as
the `/stats` swimlane: lanes are nodes, spans are node runs.

### Knowledge

Notes on the left (tree with search), the note in the middle, and the map
toggled with `M` into the right third: the Obsidian-style graph focused on
the open note (1 hop · 2 hops · whole), backlinks and links out under it,
and the note's history (who wrote it, from which thread). Humans read;
agents write: the server refuses human writes by design, so the page's verb
is **Ask an agent**, which opens a thread with the note path in the draft.
An unresolved wikilink offers the same.

### Skills

Installed skills and the marketplace are two tabs on one page: a dense
table with provider, level, enabled switch, last used; the marketplace tab
lists catalog entries with install. A skill opens in a drawer with its
SKILL.md rendered.

### GitHub

Repositories as a table (default branch, integration branch, open issues,
open PRs, last nightly build). A repository opens its **wheel**: issues
ready → implementers running → PRs open → reviews → merged → nightly, as a
timeline/strip with counts, and the linked cards. Preview data until the
GitHub app exists.

### Usage

Your share of the pools, and what you spent. One card per virtual model
(`neoproxy/default`, `small`, `heavy`, `live`): a ring of the chain's
stages (used over allowed) and the chain itself drawn left to right (stage →
demote → stage → terminal), spend as 14 bars, a requests table. Admins pick
any account and see the providers table with the "hidden from pickers"
switch. Vocabulary is NeoProxy's: virtual models, stages, terminal,
allotment. Preview data until NeoProxy accounts exist.

### Settings

Sections as cards on one scrolling page with an in-page index on the left:
Engine (NeoPi tree, version, switch), Providers (what NeoProxy exposes,
hide/show per provider: the admin's filter), Accounts (users, roles, quotas),
Integrations (Telegram, GitHub app, MCP servers), Appearance (theme), and
**Advanced** (admin only, last in the index): environment variables, the raw
NeoPi `config.yml`, the deck's own config, each as a dense key/value table
with inline edit and a restart marker. Advanced is demoted, not exiled.

## 5. Model selection

The quick switcher follows NeoPi's `/switch`, separate from the full `/models`
configuration page. It opens at conversation width above the composer, with a
provider rail and rows for native `@role` policies and concrete `provider/model`
selectors. Each row has intelligence, TTFT, tokens/s, effective context and
input/output cost per million. Missing facts say Unknown. A role names a policy
and shows its current resolution without replacing its identity.

Search goes through NeoPi's native `query_model_selector` engine. Older backends
without it show a live catalogue with search explicitly unavailable; Deck never
copies native matching or regex rules. Hidden providers leave every Deck picker,
including admins' pickers, without disabling inference. Opening and searching
never choose a model. Effort is applied only when a row is chosen. Escape closes
the portaled switcher and restores focus; arrows and Enter operate its results.

The composer is a fixed 116 px region: three lines that scroll, then one
bar with the target agent (`ctrl+]` / `ctrl+[` cycle, "All" broadcasts),
the model chip, dictation and send. It never grows.

## 6. Data: live, preview, and the contract

Every page talks to a typed client in `apps/web/src/neo/client/<domain>.ts`.
Each client has a **live** adapter (existing deck endpoints) and a
**preview** adapter (in-memory fixtures). The registry in
`neo/client/source.ts` chooses per domain; a page whose data comes from a
preview adapter shows the `preview data` chip in its header. Nothing is
faked into the real backend. The endpoints the preview adapters stand in
for are specified in `docs/design/backend-contracts.md`.

| Domain | Live today | Preview |
| --- | --- | --- |
| auth, accounts | – | users, login, me |
| inbox | list/create/update/promote | classifier proposal, history |
| board | tasks, states, moves, runs | evidence timeline, origin, holder, links |
| threads | sessions, transcript, ws, send, abort | agents per thread, colours, cycle target, spawn |
| models | `/api/models`, model roles | virtual models |
| dictation | – | transcription (`POST /api/dictation/transcribe`) |
| agents | live sessions, spawned agents, advisors | roster across deck, templates, judge log |
| studio | routines + runs + the builder, kb graph | pipelines, routers, classifiers, board flows, runs |
| knowledge | tree, file, graph, backlinks, search | history |
| skills | skills, marketplace, sources | last used |
| github | – | repos, issues, PRs, wheel, file issue |
| usage | – | virtual models, rings, chains, spend, requests |
| settings | env, npi config, models, MCP, bridges, workspaces, notifications, engine | accounts, dictation, GitHub app, exposure |

## 7. Decisions she can reject

1. No Home page; the Inbox carries the Today strip.
2. Marketplace folded into Skills as a tab; Mixtures and Advisors folded into
   Agents (a mixture is a graph in Studio, an advisor is a template).
3. The three-column shell with toggles is gone; detail opens in a drawer
   or a fixed detail column.
4. The composer is a fixed 3-line region; long messages scroll inside it.
5. Model selection uses one wide, keyboard-operated native switcher everywhere.
6. Legacy deck stays mounted at `/legacy` until parity.
7. Environment variables and raw NeoPi config live under Settings ›
   Advanced, admin only, as key/value tables rather than forms.
8. Knowledge has no human editor: "Ask an agent" is the write path, because
   the server already refuses human writes and the vision has agents author
   notes.
9. Studio embeds the existing routine builder for Flows instead of
   re-implementing it; the new canvas serves the other kinds.
10. Routers in Studio and virtual models in NeoProxy are the same object
    drawn two ways; NeoDeck's Usage uses NeoProxy's vocabulary (stages,
    terminal, allotment) so the two pages never disagree.
11. Agents spawned from a thread live only in the preview adapter until the
    threads contract (§4) exists; the live deck still has one agent per
    session.
