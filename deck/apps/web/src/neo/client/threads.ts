import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { ChatMessage, ToolCallStream } from "@/lib/types";
import { PREVIEW_TEMPLATES, type Restriction } from "./preview-data";
import { hueFor } from "../components/AgentSwatch";
import { SOURCES } from "./source";

/** An equal member of a thread. spawnedBy is a relationship (who started it), never a kind of agent. */
export interface ThreadAgent {
	id: string;
	name: string;
	hue: number;
	model: string;
	template: string;
	state: "needs-you" | "working" | "idle";
	restrictions: Restriction[];
	spawnedBy?: string;
}
/** A thread may be a persisted/live deck session or an explicitly labelled preview. */
export interface ThreadSummary {
	id: string;
	title: string;
	project?: string;
	agents: ThreadAgent[];
	state: "needs-you" | "working" | "settled";
	updatedAt: string;
	live: boolean;
	sessionPath?: string;
}
/** The future thread-agent POST body, with independently removable restrictions. */
export interface AddThreadAgentInput {
	name: string;
	hue: number;
	model: string;
	template: string;
	restrictions: Restriction[];
}
/** Existing transcript messages with participant attribution and optional user addressees. */
export type ThreadMessage = ChatMessage & { agentId?: string; addressedTo?: string[] };
/** Preview transcript and tool lifecycles use exactly the live store's message shapes. */
export interface ThreadTranscript { messages: ThreadMessage[]; toolCalls: Record<string, ToolCallStream> }
export interface ThreadsClient {
	list(): Promise<ThreadSummary[]>;
	previewList(): ThreadSummary[];
	agents(threadId: string): Promise<ThreadAgent[]>;
	addAgent(threadId: string, input: AddThreadAgentInput): Promise<ThreadAgent>;
	removeAgent(threadId: string, agentId: string): Promise<void>;
	transcript(threadId: string): ThreadTranscript;
	rename(threadId: string, name: string): Promise<void>;
	settle(threadId: string, settled: boolean): void;
	setModel(threadId: string, agentId: string, model: string): Promise<void>;
	send(threadId: string, targets: readonly string[], text: string): void;
	stop(threadId: string, targets: readonly string[]): void;
	dispose(threadId: string): Promise<void>;
	/** Members added in the deck to live threads: preview until NeoPi hosts equal agents (neopi#11). */
	previewMembers(): Array<{ threadId: string; agent: ThreadAgent }>;
}
const listeners = new Set<() => void>();
let revision = 0;
function emit(): void { revision++; for (const listener of listeners) listener(); }
export function useThreadsRevision(): number {
	return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => revision);
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function agent(id: string, name: string, template = "blank", state: ThreadAgent["state"] = "idle", spawnedBy?: string): ThreadAgent {
	const t = PREVIEW_TEMPLATES.find((item) => item.id === template)!;
	return { id, name, hue: hueFor(name), template, state, model: t.model, restrictions: t.restrictions.map((r) => ({ ...r })), ...(spawnedBy ? { spawnedBy } : {}) };
}
const fixtures: ThreadSummary[] = [
	{ id: "preview:anchors", title: "Fix the broken anchor links in getting-started", project: "atlas", agents: [agent("main", "Main", "blank", "needs-you"), agent("reviewer", "Reviewer", "advisor")], state: "needs-you", updatedAt: ago(12), live: false },
	{ id: "preview:build", title: "Why is the build slower since 0.4?", project: "atlas", agents: [agent("main", "Main", "blank", "working"), agent("worker", "Worker", "worker", "working", "main")], state: "working", updatedAt: ago(3), live: false },
	{ id: "preview:release", title: "Draft 0.5 release notes", project: "atlas", agents: [agent("main", "Main", "blank", "working"), agent("chronicler", "Chronicler", "chronicler")], state: "working", updatedAt: ago(24), live: false },
	{ id: "preview:theme", title: "Dark theme toggle", project: "portal", agents: [agent("main", "Main")], state: "settled", updatedAt: ago(180), live: false },
	{ id: "preview:flaky", title: "Freeze the clock in the flaky test", project: "atlas", agents: [agent("main", "Main")], state: "settled", updatedAt: ago(360), live: false },
	{ id: "preview:sitemap", title: "Sitemap lastmod dates", project: "portal", agents: [agent("main", "Main")], state: "settled", updatedAt: ago(1500), live: false },
];
const transcripts = new Map<string, ThreadTranscript>();
function user(id: string, text: string, minutes = 120): ThreadMessage { return { id, role: "user", text, timestamp: Date.now() - minutes * 60_000 }; }
function reply(id: string, text: string, agentId = "main", tokens = 1200): ThreadMessage {
	return { id, role: "assistant", agentId, blocks: [{ type: "text", text }], isStreaming: false, model: "neoproxy/default", timestamp: Date.now() - 100 * 60_000, durationMs: 4100, usage: { input: tokens - 240, output: 240, totalTokens: tokens, cacheRead: 0, cacheWrite: 0, cost: 0.017 } };
}
const anchorMessages: ThreadMessage[] = [
	user("a1", "The anchors 404 after the heading rename. Can you check getting-started and the sidebar?"),
	reply("a2", "I'll check the headings against their incoming links before changing anything."),
	{ id: "a3", role: "assistant", agentId: "main", isStreaming: false, blocks: [{ type: "thinking", thinking: "Compare generated heading slugs with the links, then check the sidebar separately." }, { type: "toolCall", id: "read-anchors", name: "read", arguments: { path: "docs/getting-started.md" } }] },
	{ id: "a4", role: "toolResult", toolCallId: "read-anchors", toolName: "read", content: [{ type: "text", text: "# Getting started\n## Install the CLI\n## Configure a provider\n## Your first thread" }], isError: false },
	reply("a5", "Three links still point at `#install`. The heading now produces `#install-the-cli`. The page itself is fine; its incoming links need updating."),
	{ id: "a6", role: "assistant", agentId: "main", isStreaming: false, blocks: [{ type: "toolCall", id: "grep-anchors", name: "grep", arguments: { pattern: "#install", path: "docs/" } }, { type: "toolCall", id: "read-sidebar", name: "read", arguments: { path: "docs/sidebar.ts" } }] },
	{ id: "a7", role: "toolResult", toolCallId: "grep-anchors", toolName: "grep", content: [{ type: "text", text: "docs/index.md:18 getting-started#install\ndocs/sidebar.ts:9 getting-started#install\ndocs/migration.md:32 getting-started#install" }], isError: false },
	reply("a8", "One of them is in the sidebar too. Update that entry alongside the two prose links, otherwise navigation will still land at the top of the page.", "reviewer", 1100),
	user("a9", "Yes, fix all three. Should we make the link checker fail the build too?", 18),
	reply("a10", "All three links are updated. The checker currently only warns. **Should broken internal anchors fail CI**, or would you rather keep that as a warning for now?", "main", 1800),
];
transcripts.set("preview:anchors", { messages: anchorMessages, toolCalls: {
	"read-anchors": { id: "read-anchors", name: "read", args: { path: "docs/getting-started.md" }, status: "complete", isError: false, startedAt: 1000, endedAt: 2200, result: "# Getting started\n## Install the CLI", resultContent: [{ type: "text", text: "# Getting started\n## Install the CLI" }] },
	"grep-anchors": { id: "grep-anchors", name: "grep", args: { pattern: "#install", path: "docs/" }, status: "complete", isError: false, startedAt: 3000, endedAt: 3300, result: "3 matching links", resultContent: [{ type: "text", text: "3 matching links" }] },
	"read-sidebar": { id: "read-sidebar", name: "read", args: { path: "docs/sidebar.ts" }, status: "complete", isError: false, startedAt: 4000, endedAt: 4500, result: "{ label: 'Install', href: 'getting-started#install' }", resultContent: [{ type: "text", text: "{ label: 'Install', href: 'getting-started#install' }" }] },
} });
transcripts.set("preview:build", { messages: [user("b1", "The docs build takes 38 seconds now. It was 12 before 0.4. Find out where the time goes."), reply("b2", "The content set hasn't grown enough to explain it. Worker is measuring the render and asset passes separately."), reply("b3", "The asset manifest is being rebuilt once per page. I'm tracing the change that moved it inside the render loop.", "worker")], toolCalls: {} });
transcripts.set("preview:release", { messages: [user("r1", "Draft the 0.5 release notes from the merged work, without promising anything still on a branch."), reply("r2", "I'll group the changes by what a person can do now. Chronicler is checking the decisions behind the new defaults."), reply("r3", "The new defaults and their rationale are captured in `decisions/0004-release-cadence.md`.", "chronicler")], toolCalls: {} });
for (const item of fixtures.slice(3)) transcripts.set(item.id, { messages: [user(`${item.id}-u`, `Let's finish ${item.title.toLowerCase()}.`), reply(`${item.id}-a`, "The change is in place and the evidence is recorded on its card. Nothing else is waiting here.")], toolCalls: {} });
const extraAgents = new Map<string, ThreadAgent[]>();
const timers = new Map<string, number>();
const SETTLED_KEY = "neodeck.threads.settled";
function readSettled(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(SETTLED_KEY) ?? "[]") as string[]); } catch { return new Set(); } }
const settled = readSettled();
const reopened = new Set<string>();
const emptyTranscript: ThreadTranscript = { messages: [], toolCalls: {} };
function liveAgents(id: string): ThreadAgent[] {
	const store = useStore.getState();
	const session = store.sessionsById[id];
	const main = agent("main", "Main", "blank", session && session.status !== "idle" ? "working" : "idle");
	// Keep the selected policy (`@role`) rather than its resolved model, with the reported effort.
	const selector = session?.modelSelector ?? (session?.model ? `${session.model.provider}/${session.model.id}` : undefined);
	main.model = selector ? (session?.thinkingLevel && !/:[a-z]+$/.test(selector) ? `${selector}:${session.thinkingLevel}` : selector) : "No model selected";
	return [main, ...(extraAgents.get(id) ?? []), ...(store.subagentsBySession[id] ?? []).map((node) => ({ ...agent(node.id, node.name, "worker", /running|working|streaming/.test(node.status) ? "working" : "idle", node.parentId), model: "Unknown" }))];
}
const preview: ThreadsClient = {
	previewMembers() { return [...extraAgents].flatMap(([threadId, list]) => list.map((agent) => ({ threadId, agent }))); },
	previewList() { return fixtures.map((item) => ({ ...item, agents: [...item.agents] })); },
	async list() { return fixtures.map((item) => ({ ...item, agents: [...item.agents] })); },
	async agents(id) { return fixtures.find((item) => item.id === id)?.agents ?? extraAgents.get(id) ?? []; },
	async addAgent(id, input) {
		const added: ThreadAgent = { ...input, restrictions: input.restrictions.map((r) => ({ ...r })), id: crypto.randomUUID(), state: "idle" };
		const fixture = fixtures.find((item) => item.id === id);
		if (fixture) fixture.agents = [...fixture.agents, added]; else extraAgents.set(id, [...(extraAgents.get(id) ?? []), added]);
		emit(); return added;
	},
	async removeAgent(id, agentId) { const fixture = fixtures.find((item) => item.id === id); if (fixture) fixture.agents = fixture.agents.filter((a) => a.id !== agentId); else extraAgents.set(id, (extraAgents.get(id) ?? []).filter((a) => a.id !== agentId)); emit(); },
	transcript(id) { return transcripts.get(id) ?? emptyTranscript; },
	async rename(id, title) { const item = fixtures.find((t) => t.id === id); if (item) item.title = title; emit(); },
	settle(id, value) { const item = fixtures.find((t) => t.id === id); if (item) item.state = value ? "settled" : "needs-you"; emit(); },
	async setModel(id, agentId, model) { const agents = fixtures.find((t) => t.id === id)?.agents ?? extraAgents.get(id); const target = agents?.find((a) => a.id === agentId); if (target) target.model = model; emit(); },
	send(id, targets, text) {
		const item = fixtures.find((t) => t.id === id);
		const agents = item?.agents ?? extraAgents.get(id) ?? [];
		const targetAgents = agents.filter((a) => targets.includes(a.id));
		const previous = transcripts.get(id) ?? emptyTranscript;
		transcripts.set(id, { ...previous, messages: [...previous.messages, { ...user(crypto.randomUUID(), text, 0), addressedTo: targetAgents.map((a) => a.name) }] });
		for (const a of targetAgents) { a.state = "working"; const key = `${id}:${a.id}`; clearTimeout(timers.get(key)); timers.set(key, window.setTimeout(() => {
			a.state = "idle"; const t = transcripts.get(id) ?? emptyTranscript;
			transcripts.set(id, { ...t, messages: [...t.messages, { id: crypto.randomUUID(), role: "notice", level: "info", timestamp: Date.now(), message: `Sent to ${a.name} · this agent answers once the thread backend serves more than one agent (preview)` }] });
			if (item) item.state = item.agents.some((a) => a.state === "working") ? "working" : "needs-you";
			emit(); timers.delete(key);
		}, 1500)); }
		if (item) { item.state = "working"; item.updatedAt = ago(0); } emit();
	},
	stop(id, targets) { const item = fixtures.find((t) => t.id === id); for (const a of item?.agents ?? extraAgents.get(id) ?? []) if (targets.includes(a.id)) { const key = `${id}:${a.id}`; clearTimeout(timers.get(key)); timers.delete(key); a.state = "idle"; } if (item) item.state = "needs-you"; emit(); },
	async dispose(id) { const index = fixtures.findIndex((t) => t.id === id); if (index >= 0) fixtures.splice(index, 1); transcripts.delete(id); emit(); },
};
const live: ThreadsClient = {
	...preview,
	async list() {
		const store = useStore.getState();
		const persisted = store.sessions.length ? store.sessions : (await api.listSessions()).sessions;
		const rows = new Map<string, ThreadSummary>();
		for (const session of persisted) rows.set(session.id, { id: session.id, title: session.title || "Untitled thread", project: session.cwd, agents: liveAgents(session.id), state: "settled", updatedAt: session.updatedAt || session.createdAt, live: true, sessionPath: session.path });
		for (const session of Object.values(store.sessionsById)) {
			const previous = rows.get(session.sessionId);
			rows.set(session.sessionId, { id: session.sessionId, title: session.sessionName || session.messages.find((m) => m.role === "user")?.text.slice(0, 60) || previous?.title || "New thread", project: session.cwd, agents: liveAgents(session.sessionId), state: settled.has(session.sessionId) ? "settled" : session.status !== "idle" ? "working" : session.readOnly && !reopened.has(session.sessionId) ? "settled" : "needs-you", updatedAt: previous?.updatedAt ?? ago(0), live: true, sessionPath: session.sessionFile ?? previous?.sessionPath });
		}
		return [...rows.values(), ...await preview.list()];
	},
	async agents(id) { return fixtures.some((t) => t.id === id) ? preview.agents(id) : liveAgents(id); },
	async rename(id, title) { if (fixtures.some((t) => t.id === id)) return preview.rename(id, title); await useStore.getState().renameSession(id, title); },
	settle(id, value) { if (fixtures.some((t) => t.id === id)) return preview.settle(id, value); if (value) { settled.add(id); reopened.delete(id); } else { settled.delete(id); reopened.add(id); } localStorage.setItem(SETTLED_KEY, JSON.stringify([...settled])); emit(); },
	async setModel(id, agentId, model) {
		if (fixtures.some((t) => t.id === id) || agentId !== "main") return preview.setModel(id, agentId, model);
		const liveId = await useStore.getState().resumeSession(id);
		await api.setSessionSelector(liveId, model);
	},
	async dispose(id) { if (fixtures.some((t) => t.id === id)) return preview.dispose(id); await useStore.getState().disposeSession(id); settled.add(id); emit(); },
};
export const threads: ThreadsClient = SOURCES.threads === "live" ? live : preview;
