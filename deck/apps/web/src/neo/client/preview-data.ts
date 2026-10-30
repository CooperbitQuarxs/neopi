/**
 * Preview fixtures: the office the deck is designed for, as data. Every
 * shape here is the contract a backend will serve later
 * (docs/design/backend-contracts.md). Nothing is the owner's data.
 */

/* ---------------------------------------------------------------- accounts */

export interface Account {
	id: string;
	handle: string;
	name: string;
	role: "admin" | "member";
	/** Hue for the avatar swatch, 0–360. */
	hue: number;
	/** Roles the admin mapped for this account, as `neoproxy/<name>`. */
	roles: readonly string[];
	/** Fraction of every virtual-model budget granted to this account; omitted means 100%. */
	allotment?: number;
}

export const PREVIEW_ACCOUNTS: readonly Account[] = [
	{ id: "u_admin", handle: "admin", name: "Shay", role: "admin", hue: 300, roles: ["default", "small", "heavy", "live"] },
	{ id: "u_lin", handle: "lin", name: "Lin", role: "member", hue: 190, roles: ["default", "small"] },
	{ id: "u_ada", handle: "ada", name: "Ada", role: "member", hue: 40, roles: ["default", "small", "heavy"] },
];

/* ---------------------------------------------------------------- providers and pools */

export interface ProviderExposure {
	id: string;
	label: string;
	/** Hidden from pickers by the admin (still served). */
	hidden: boolean;
	accounts: number;
	models: readonly string[];
}

export const PREVIEW_PROVIDERS: readonly ProviderExposure[] = [
	{ id: "anthropic", label: "Anthropic", hidden: false, accounts: 2, models: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
	{ id: "codex", label: "OpenAI Codex", hidden: false, accounts: 3, models: ["gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol", "gpt-live-1-1"] },
	{ id: "xai", label: "xAI", hidden: false, accounts: 1, models: ["grok-4.7", "grok-4.5-fast"] },
	{ id: "zai", label: "Z.ai", hidden: true, accounts: 1, models: ["glm-5.1", "glm-5.1-air"] },
	{ id: "cerebras", label: "Cerebras", hidden: true, accounts: 1, models: ["qwen-3.5-480b", "llama-4-maverick"] },
	{ id: "github", label: "GitHub Models", hidden: false, accounts: 1, models: ["gpt-6-luna", "claude-sonnet-5-5"] },
];

export interface Pool {
	/** `neoproxy/<role>`. */
	role: string;
	/** Ordered chain: each step is a provider pool with a share of it, then a demotion. */
	chain: readonly { provider: string; model: string; sharePct: number; usedPct: number }[];
	/** Spend this period, USD at API-equivalent rates. */
	spentUsd: number;
	requests: number;
	resetsAt: string;
}

export const PREVIEW_POOLS: readonly Pool[] = [
	{ role: "heavy", chain: [{ provider: "codex", model: "gpt-6-astra", sharePct: 15, usedPct: 11 }, { provider: "codex", model: "gpt-6.1-sol", sharePct: 20, usedPct: 2 }], spentUsd: 41.2, requests: 318, resetsAt: "2026-10-27T00:00:00Z" },
	{ role: "default", chain: [{ provider: "anthropic", model: "claude-sonnet-5-5", sharePct: 10, usedPct: 7.4 }, { provider: "codex", model: "gpt-6-luna", sharePct: 10, usedPct: 0.3 }], spentUsd: 18.9, requests: 1264, resetsAt: "2026-10-27T00:00:00Z" },
	{ role: "small", chain: [{ provider: "codex", model: "gpt-6-luna", sharePct: 25, usedPct: 9 }], spentUsd: 2.1, requests: 2210, resetsAt: "2026-10-27T00:00:00Z" },
	{ role: "live", chain: [{ provider: "codex", model: "gpt-live-1-1", sharePct: 5, usedPct: 0.8 }], spentUsd: 0.6, requests: 14, resetsAt: "2026-10-27T00:00:00Z" },
];

export interface SpendPoint {
	day: string;
	usd: number;
}

export const PREVIEW_SPEND: readonly SpendPoint[] = Array.from({ length: 14 }, (_, i) => ({
	day: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
	usd: [3.1, 4.4, 2.2, 6.8, 5.1, 0.4, 0.2, 7.9, 6.3, 5.5, 8.2, 4.1, 3.6, 4.9][i]!,
}));

/* ---------------------------------------------------------------- agents */

export type AgentState = "needs-you" | "working" | "parked" | "idle" | "done";

export interface Restriction {
	key: "visibility" | "lifecycle" | "spawn" | "model" | "prompt" | "tools";
	label: string;
}

export interface AgentTemplate {
	id: string;
	name: string;
	blurb: string;
	model: string;
	restrictions: readonly Restriction[];
}

export const PREVIEW_TEMPLATES: readonly AgentTemplate[] = [
	{ id: "worker", name: "Worker", blurb: "Does the work and reports; yields when it is done.", model: "neoproxy/heavy", restrictions: [{ key: "lifecycle", label: "yields on deliverable" }, { key: "spawn", label: "may spawn workers" }] },
	{ id: "advisor", name: "Advisor", blurb: "Reads the thread it is attached to and leaves notes; never acts.", model: "neoproxy/default", restrictions: [{ key: "visibility", label: "reads one thread" }, { key: "tools", label: "read-only tools" }, { key: "lifecycle", label: "cannot stop others" }] },
	{ id: "chronicler", name: "Chronicler", blurb: "Turns a conversation into durable notes as it happens.", model: "neoproxy/small", restrictions: [{ key: "visibility", label: "reads one thread" }, { key: "tools", label: "writes to knowledge only" }] },
	{ id: "judge", name: "Judge", blurb: "Watches every session; flags stuck work and stops what was not sanctioned.", model: "neoproxy/heavy", restrictions: [{ key: "visibility", label: "reads every thread" }, { key: "lifecycle", label: "may stop any agent" }, { key: "spawn", label: "cannot spawn" }] },
	{ id: "warden", name: "Warden", blurb: "Keeps one long process going; persists until dismissed.", model: "neoproxy/default", restrictions: [{ key: "lifecycle", label: "persists" }, { key: "spawn", label: "may message peers" }] },
	{ id: "blank", name: "Blank", blurb: "An agent with no restrictions. Same prompt, same tools, same everything as you.", model: "neoproxy/default", restrictions: [] },
];

export interface LiveAgent {
	id: string;
	name: string;
	template: string;
	model: string;
	/** Where it is working: a thread title, a card ref or a routine name. */
	where: { kind: "thread" | "card" | "routine"; id: string; label: string };
	state: AgentState;
	owner: string;
	tokens: number;
	costUsd: number;
	since: string;
	/** Colour hue for its swatch in a thread. */
	hue: number;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const PREVIEW_AGENTS: readonly LiveAgent[] = [
	{ id: "ag_main_anchors", name: "Main", template: "blank", model: "neoproxy/default", where: { kind: "thread", id: "preview:anchors", label: "Fix the broken anchor links in getting-started" }, state: "needs-you", owner: "admin", tokens: 184_000, costUsd: 0.14, since: minutesAgo(192), hue: 190 },
	{ id: "ag_rev_anchors", name: "Reviewer", template: "advisor", model: "neoproxy/default", where: { kind: "thread", id: "preview:anchors", label: "Fix the broken anchor links in getting-started" }, state: "idle", owner: "admin", tokens: 41_000, costUsd: 0.03, since: minutesAgo(190), hue: 300 },
	{ id: "ag_worker_T5", name: "Worker", template: "worker", model: "neoproxy/heavy", where: { kind: "card", id: "T-5", label: "T-5 Fix anchor links after heading rename" }, state: "working", owner: "lin", tokens: 92_000, costUsd: 0.31, since: minutesAgo(23), hue: 40 },
	{ id: "ag_worker_T6", name: "Worker", template: "worker", model: "neoproxy/heavy", where: { kind: "card", id: "T-6", label: "T-6 Dark theme toggle" }, state: "working", owner: "ada", tokens: 310_000, costUsd: 1.02, since: minutesAgo(58), hue: 40 },
	{ id: "ag_judge", name: "Judge", template: "judge", model: "neoproxy/heavy", where: { kind: "routine", id: "judge", label: "every session" }, state: "working", owner: "admin", tokens: 1_240_000, costUsd: 3.9, since: minutesAgo(1440), hue: 150 },
	{ id: "ag_chron", name: "Chronicler", template: "chronicler", model: "neoproxy/small", where: { kind: "thread", id: "preview:release", label: "Draft 0.5 release notes" }, state: "parked", owner: "admin", tokens: 22_000, costUsd: 0.01, since: minutesAgo(2900), hue: 260 },
	{ id: "ag_warden", name: "Warden", template: "warden", model: "neoproxy/default", where: { kind: "routine", id: "nightly-docs-build", label: "nightly-docs-build" }, state: "parked", owner: "admin", tokens: 8_000, costUsd: 0.01, since: minutesAgo(600), hue: 20 },
];

export interface JudgeEvent {
	id: string;
	at: string;
	tone: "ok" | "warn" | "bad" | "info";
	agent: string;
	where: string;
	text: string;
}

/* ---------------------------------------------------------------- github */

export interface Repo {
	id: string;
	name: string;
	defaultBranch: string;
	integrationBranch: string | null;
	openIssues: number;
	openPrs: number;
	lastNightly: { at: string; ok: boolean } | null;
}

export const PREVIEW_REPOS: readonly Repo[] = [
	{ id: "atlas", name: "office/atlas", defaultBranch: "main", integrationBranch: "nightly", openIssues: 14, openPrs: 3, lastNightly: { at: minutesAgo(380), ok: true } },
	{ id: "portal", name: "office/portal", defaultBranch: "main", integrationBranch: null, openIssues: 6, openPrs: 1, lastNightly: null },
	{ id: "qpanel", name: "office/qpanel", defaultBranch: "master", integrationBranch: "nightly", openIssues: 22, openPrs: 0, lastNightly: { at: minutesAgo(1500), ok: false } },
];

export type WheelStage = "ready" | "implementing" | "pr" | "review" | "merged" | "nightly";

export interface WheelItem {
	id: string;
	repo: string;
	number: number;
	title: string;
	stage: WheelStage;
	agent?: string;
	card?: string;
	since: string;
}

export const PREVIEW_WHEEL: readonly WheelItem[] = [
	{ id: "w1", repo: "atlas", number: 231, title: "Add lastmod to the sitemap", stage: "ready", since: minutesAgo(600) },
	{ id: "w2", repo: "atlas", number: 229, title: "Benchmark the render cache on the 400-page site", stage: "ready", since: minutesAgo(900) },
	{ id: "w3", repo: "atlas", number: 226, title: "Fix anchor links after heading rename", stage: "implementing", agent: "Worker", card: "T-5", since: minutesAgo(23) },
	{ id: "w4", repo: "atlas", number: 224, title: "Dark theme toggle", stage: "implementing", agent: "Worker", card: "T-6", since: minutesAgo(58) },
	{ id: "w5", repo: "atlas", number: 212, title: "Cache the first render pass", stage: "review", agent: "Worker", card: "T-10", since: minutesAgo(95) },
	{ id: "w6", repo: "atlas", number: 208, title: "Pin bun 1.3 in CI", stage: "merged", card: "T-9", since: minutesAgo(1300) },
	{ id: "w7", repo: "atlas", number: 201, title: "Freeze the clock in render tests", stage: "nightly", card: "T-7", since: minutesAgo(2100) },
	{ id: "w8", repo: "portal", number: 44, title: "File depot: resumable uploads", stage: "pr", agent: "Worker", since: minutesAgo(140) },
];

/* ---------------------------------------------------------------- studio */

export type GraphKind = "flow" | "pipeline" | "router" | "classifier" | "boardflow";

export interface GraphSummary {
	id: string;
	kind: GraphKind;
	name: string;
	description: string;
	nodes: number;
	lastRun?: { at: string; ok: boolean };
	enabled: boolean;
}

export const PREVIEW_GRAPHS: readonly GraphSummary[] = [
	{ id: "p_inbox", kind: "pipeline", name: "inbox-classify", description: "Capture → small model classifies → proposal on the item", nodes: 4, lastRun: { at: minutesAgo(3), ok: true }, enabled: true },
	{ id: "p_pr", kind: "pipeline", name: "pr-review", description: "PR opened → three reviewers → judge decides → comment", nodes: 7, lastRun: { at: minutesAgo(95), ok: true }, enabled: true },
	{ id: "r_default", kind: "router", name: "default", description: "sonnet 10% → luna 10% → limit", nodes: 3, enabled: true },
	{ id: "r_heavy", kind: "router", name: "heavy", description: "astra 15% across 3 accounts → sol 20% → limit", nodes: 4, enabled: true },
	{ id: "c_kind", kind: "classifier", name: "inbox-kind", description: "ticket / idea / decision / investigation", nodes: 2, lastRun: { at: minutesAgo(3), ok: true }, enabled: true },
	{ id: "b_wheel", kind: "boardflow", name: "implementation-wheel", description: "backlog → assign worker → PR → review → done", nodes: 6, enabled: true },
];
