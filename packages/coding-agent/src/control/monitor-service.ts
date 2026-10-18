/**
 * Agent monitor service behind the control socket's `monitor` command (#345).
 *
 * Attach-mode panes (`npi monitor attach`) render one agent through the shared
 * Agent Hub transcript viewer. This service is their only view of the owner:
 * the root-scoped hub roster as structured snapshots, bounded incremental
 * transcript reads, and chat with exactly the hub's rules. It never exposes
 * the primary session, slash commands, kill, or keystroke routes.
 */
import type { AgentHubRegistry, AgentLifecycleLike } from "@oh-my-pi/pi-tui/overlays/agent-hub-types";
import { isRecord } from "@oh-my-pi/pi-utils";
import { createAgentHubRuntime } from "../modes/agent-hub-runtime";
import type { AgentRef, AgentRegistry, AgentStatus } from "../registry/agent-registry";
import type { AgentSession } from "../session/agent-session";
import { readTranscriptSlice, type TranscriptSlice } from "../session/transcript-slice";

/** One roster row as an attach pane sees it. */
export interface MonitorAgentSnapshot {
	id: string;
	displayName: string;
	kind: "sub" | "advisor";
	parentId?: string;
	status: AgentStatus;
	/** Whether the owner has a transcript file for this agent. */
	hasSessionFile: boolean;
	createdAt: number;
	lastActivity: number;
}

/** Pushed to subscribed connections whenever the scoped roster changes. */
export interface MonitorAgentsFrame {
	type: "monitor_agents";
	agents: MonitorAgentSnapshot[];
}

/**
 * Per-read transcript cap. One reply must fit a single protocol-v1 frame
 * (`MAX_RPC_FRAME_BYTES`, 1 MiB) after JSON escaping; panes re-request from
 * `newSize` until they reach the end.
 */
export const MONITOR_TRANSCRIPT_READ_CAP = 256 * 1024;
/** Roster pushes coalesce registry bursts (spawn waves, park sweeps). */
const MONITOR_PUSH_DEBOUNCE_MS = 100;
const MAX_CHAT_CHARS = 32 * 1024;

/** A connection the service can push roster frames to. */
export interface MonitorSink {
	write(frame: object): void;
}

export interface MonitorServiceOptions {
	session: AgentSession;
	registry: AgentRegistry;
}

function monitored(ref: AgentRef): ref is AgentRef & { kind: "sub" | "advisor" } {
	return ref.kind === "sub" || ref.kind === "advisor";
}

function toSnapshot(ref: AgentRef & { kind: "sub" | "advisor" }): MonitorAgentSnapshot {
	return {
		id: ref.id,
		displayName: ref.displayName,
		kind: ref.kind,
		...(ref.parentId ? { parentId: ref.parentId } : {}),
		status: ref.status,
		hasSessionFile: Boolean(ref.sessionFile),
		createdAt: ref.createdAt,
		lastActivity: ref.lastActivity,
	};
}

export class MonitorRequestError extends Error {
	constructor(
		readonly code: "unknown_agent" | "read_only" | "invalid_value",
		message: string,
	) {
		super(message);
		this.name = "MonitorRequestError";
	}
}

export class ControlMonitorService {
	readonly #registry: AgentHubRegistry<AgentRef>;
	readonly #lifecycle: () => AgentLifecycleLike<AgentRef>;
	readonly #subscribers = new Set<MonitorSink>();
	#unsubscribeRegistry: (() => void) | undefined;
	#pushTimer: Timer | undefined;
	#lastFrame = "";

	constructor(options: MonitorServiceOptions) {
		const { registry, session } = options;
		// The same root scoping the Agent Hub applies: only this session's tree.
		const hub = createAgentHubRuntime({ registry, root: () => registry.rootForSession(session) });
		this.#registry = hub.registry;
		this.#lifecycle = hub.lifecycle;
	}

	/** The scoped roster: subagents and advisors of this root, never the primary or mailboxes. */
	snapshot(): MonitorAgentSnapshot[] {
		return this.#registry
			.list()
			.filter(monitored)
			.map(toSnapshot)
			.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}

	subscribe(sink: MonitorSink): MonitorAgentSnapshot[] {
		this.#subscribers.add(sink);
		this.#unsubscribeRegistry ??= this.#registry.onChange(() => this.#schedulePush());
		return this.snapshot();
	}

	unsubscribe(sink: MonitorSink): void {
		this.#subscribers.delete(sink);
		if (this.#subscribers.size > 0) return;
		this.#unsubscribeRegistry?.();
		this.#unsubscribeRegistry = undefined;
		clearTimeout(this.#pushTimer);
		this.#pushTimer = undefined;
		this.#lastFrame = "";
	}

	/** Bounded incremental read of a monitored agent's transcript (advisors included, read-only). */
	async transcript(agentId: string, fromByte: number): Promise<TranscriptSlice> {
		const ref = this.#scoped(agentId);
		if (!ref.sessionFile) return { text: "", newSize: fromByte, error: "no transcript available" };
		const start = Number.isSafeInteger(fromByte) && fromByte > 0 ? fromByte : 0;
		return readTranscriptSlice(ref.sessionFile, start, MONITOR_TRANSCRIPT_READ_CAP);
	}

	/**
	 * Send a message the way the hub's transcript viewer does: revive a parked
	 * agent, steer one mid-turn, prompt an idle one. Advisors and aborted
	 * agents are read-only there, so they are rejected here.
	 */
	async chat(agentId: string, text: string): Promise<void> {
		const ref = this.#scoped(agentId);
		if (ref.kind === "advisor") throw new MonitorRequestError("read_only", `${agentId} is a read-only advisor transcript`);
		if (ref.status === "aborted") throw new MonitorRequestError("read_only", `${agentId} was aborted and is read-only`);
		const trimmed = text.trim();
		if (!trimmed) throw new MonitorRequestError("invalid_value", "empty message");
		if (trimmed.length > MAX_CHAT_CHARS) {
			throw new MonitorRequestError("invalid_value", `message exceeds ${MAX_CHAT_CHARS} characters`);
		}
		const session = await this.#lifecycle().ensureLive(agentId);
		await session.prompt(trimmed, { streamingBehavior: "steer" });
	}

	dispose(): void {
		this.#subscribers.clear();
		this.#unsubscribeRegistry?.();
		this.#unsubscribeRegistry = undefined;
		clearTimeout(this.#pushTimer);
		this.#pushTimer = undefined;
	}

	#scoped(agentId: string): AgentRef & { kind: "sub" | "advisor" } {
		const ref = this.#registry.get(agentId);
		if (!ref || !monitored(ref)) throw new MonitorRequestError("unknown_agent", `unknown agent ${agentId}`);
		return ref;
	}

	#schedulePush(): void {
		if (this.#pushTimer || this.#subscribers.size === 0) return;
		this.#pushTimer = setTimeout(() => {
			this.#pushTimer = undefined;
			const frame: MonitorAgentsFrame = { type: "monitor_agents", agents: this.snapshot() };
			const json = JSON.stringify(frame.agents);
			if (json === this.#lastFrame) return;
			this.#lastFrame = json;
			for (const sink of this.#subscribers) sink.write(frame);
		}, MONITOR_PUSH_DEBOUNCE_MS);
		this.#pushTimer.unref?.();
	}
}

/** Parse a `monitor` command's agent id; throws a typed error for a malformed frame. */
export function monitorAgentId(frame: Record<string, unknown>): string {
	const id = frame.agentId;
	if (typeof id !== "string" || id.trim() === "") throw new MonitorRequestError("invalid_value", "agentId is required");
	return id;
}

/** True for a well-formed pushed roster frame (attach-side guard). */
export function isMonitorAgentsFrame(frame: unknown): frame is MonitorAgentsFrame {
	return isRecord(frame) && frame.type === "monitor_agents" && Array.isArray(frame.agents);
}
