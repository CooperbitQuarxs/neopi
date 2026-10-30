import {
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
	type SubagentLifecyclePayload,
} from "@oh-my-pi/pi-tui/overlays/session-observer-registry";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session-events";
import { TASK_SUBAGENT_EVENT_CHANNEL, type SubagentEventPayload } from "../task/types";
import type { EventBus } from "../utils/event-bus";
import { sessionAudioEvents, record } from "./events";
import { EventSoundPlayer } from "./player";
import {
	cfgEventAudioGain,
	cfgEventAudioInterval,
	cfgEventAudioMappingPath,
	cfgEventAudioStreamInterval,
} from "./settings";

const observers = new WeakMap<AgentSession, EventAudioObserver>();

/** Interactive-only observer; disabled sessions perform no mapping I/O, decoding or event classification. */
export class EventAudioObserver {
	#subscriptions: Array<() => void> = [];
	#enabled = false;
	#disposed = false;
	#args = new Map<string, unknown>();
	#evalPositions = new Map<string, number>();
	readonly #player: EventSoundPlayer;

	constructor(
		readonly session: AgentSession,
		readonly bus: EventBus | undefined,
		options: { blocked(): boolean; warning(message: string): void },
	) {
		this.#player = new EventSoundPlayer({
			...options,
			gain: () => cfgEventAudioGain.get(session.settings),
			interval: () => cfgEventAudioInterval.get(session.settings),
			streamInterval: () => cfgEventAudioStreamInterval.get(session.settings),
		});
		observers.set(session, this);
	}

	status(): string {
		return `Event sounds ${this.#player.status()} · ${cfgEventAudioMappingPath.get(this.session.settings)}`;
	}

	async command(args: string): Promise<string> {
		const action = args.trim() || "status";
		if (this.#disposed) throw new Error("Event sound observer has closed");
		if (action === "status") return this.status();
		if (action === "off") {
			this.#disable();
			return this.status();
		}
		if (action !== "on" && action !== "reload") throw new Error("Usage: /sounds [on|off|reload|status]");
		if (action === "on" && !this.#enabled) {
			this.#enabled = true;
			this.#player.setEnabled(true);
			this.#subscriptions.push(this.session.subscribe(event => this.#observe(event, "main")));
			const manager = this.session.asyncJobManager;
			if (manager)
				this.#subscriptions.push(
					manager.subscribe(event => {
						// Foreground-backed jobs remain tool events until explicitly promoted.
						if (!event.job.foreground) this.#player.play([`async.${event.type}`]);
					}),
				);
			if (this.bus)
				this.#subscriptions.push(
					this.bus.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, value => {
						const payload = value as SubagentLifecyclePayload;
						const id =
							payload.status === "started"
								? payload.runKind === "wake"
									? "subagent.wake"
									: payload.runKind === "followUp"
										? "subagent.follow_up"
										: "subagent.start"
								: payload.status === "completed"
									? "subagent.complete"
									: payload.status === "failed"
										? "subagent.failed"
										: "subagent.aborted";
						this.#player.play([id]);
						if (payload.status !== "started") this.#clearOrigin(payload.runToken);
					}),
					this.bus.on(TASK_SUBAGENT_PROGRESS_CHANNEL, () => this.#player.play(["subagent.progress"])),
					this.bus.on(TASK_SUBAGENT_EVENT_CHANNEL, value => {
						const payload = value as SubagentEventPayload;
						this.#observe(payload.event, payload.runToken, true);
					}),
				);
		}
		await this.#player.reload(cfgEventAudioMappingPath.get(this.session.settings));
		return this.status();
	}

	#observe(event: AgentSessionEvent, origin: string, child = false): void {
		if (!this.#enabled) return;
		let candidates: string[];
		if (
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_update" ||
			event.type === "tool_execution_end"
		) {
			const key = `${origin}:${event.toolCallId}`;
			if (event.type === "tool_execution_start") {
				// Broken producers must not retain unlimited tool arguments for a long session.
				if (this.#args.size >= 512) this.#args.delete(this.#args.keys().next().value!);
				this.#args.set(key, event.args);
			}
			candidates = sessionAudioEvents(event, this.#args.get(key));
			if (event.toolName === "eval") {
				const result = record(
					event.type === "tool_execution_update"
						? event.partialResult
						: event.type === "tool_execution_end"
							? event.result
							: undefined,
				);
				const details = record(result?.details);
				const cells = Array.isArray(details?.cells) ? details.cells : [];
				// statusEvents are cumulative bounded snapshots, not fresh events on every tool update.
				this.#evalStatus(candidates, `${key}:root`, details);
				for (const cell of cells) {
					const row = record(cell);
					if (row) this.#evalStatus(candidates, `${key}:cell:${row.index}`, row);
				}
			}
			if (event.type === "tool_execution_end") {
				this.#args.delete(key);
				for (const position of this.#evalPositions.keys())
					if (position.startsWith(`${key}:`)) this.#evalPositions.delete(position);
			}
		} else {
			if (event.type === "agent_start") this.#clearOrigin(origin);
			candidates = sessionAudioEvents(event);
		}
		// Raw child events retain their real event identity; generic child-event is only a fallback.
		if (child) candidates.push("subagent.event");
		this.#player.play(candidates);
	}

	#evalStatus(candidates: string[], key: string, details: Record<string, unknown> | undefined): void {
		if (!Array.isArray(details?.statusEvents)) return;
		const elided = typeof details.statusEventsElided === "number" ? details.statusEventsElided : 0;
		const previous = this.#evalPositions.get(key) ?? 0;
		const hasFailure = candidates.some(id => id.startsWith("error.") || id.endsWith(".error"));
		for (let index = Math.max(0, previous - elided); index < details.statusEvents.length; index++) {
			const status = record(details.statusEvents[index]);
			if (!hasFailure) {
				if (status?.op === "phase" || status?.op === "log") candidates.unshift(`eval.${status.op}`);
				if (status?.op === "todo" && status.committed === true) candidates.unshift("todo.changed");
			}
		}
		if (this.#evalPositions.size >= 1024 && !this.#evalPositions.has(key))
			this.#evalPositions.delete(this.#evalPositions.keys().next().value!);
		this.#evalPositions.set(key, elided + details.statusEvents.length);
	}

	#clearOrigin(origin: string): void {
		for (const key of this.#args.keys()) if (key.startsWith(`${origin}:`)) this.#args.delete(key);
		for (const key of this.#evalPositions.keys()) if (key.startsWith(`${origin}:`)) this.#evalPositions.delete(key);
	}

	#disable(): void {
		this.#enabled = false;
		for (const unsubscribe of this.#subscriptions) unsubscribe();
		this.#subscriptions = [];
		this.#args.clear();
		this.#evalPositions.clear();
		this.#player.setEnabled(false);
	}

	dispose(): void {
		this.#disposed = true;
		this.#disable();
		this.#player.dispose();
		observers.delete(this.session);
	}
}

export async function eventAudioCommand(session: AgentSession, args: string): Promise<string> {
	const observer = observers.get(session);
	if (!observer) throw new Error("Event sounds require the interactive harness");
	return observer.command(args);
}
