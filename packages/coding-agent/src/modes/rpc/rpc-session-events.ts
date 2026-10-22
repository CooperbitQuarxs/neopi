/**
 * Session-event forwarding for RPC mode: stamps message lifecycle frames with a
 * `messageId` and applies the host's `set_event_filter` selection.
 */
import type { AssistantMessageEvent } from "@oh-my-pi/pi-ai";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "../../session/agent-session";
import { getMessageEntryId, getMessageEntrySource } from "../../session/message-entry-ids";
import type { SessionManager } from "../../session/session-manager";
import type { SessionJournalEvent } from "../../session/session-journal-events";
import type {
	RpcAgentSessionEventFrame,
	RpcDeltaMessageUpdateFrame,
	RpcMessageUpdates,
	RpcProjectedSessionEventFrame,
} from "./rpc-types";

/** Drops the accumulated snapshot a streaming event carries; `done` and `error` have none. */
function withoutPartial(event: AssistantMessageEvent): RpcDeltaMessageUpdateFrame["assistantMessageEvent"] {
	if (!("partial" in event)) return event;
	const { partial: _partial, ...increment } = event;
	return increment;
}

/**
 * Writes session events to the RPC output. Message ids are assigned whether or
 * not the frame passes the filter, so changing the filter mid-message never
 * splits one message across two ids.
 */
export class RpcSessionEventForwarder {
	#filter: Set<string> | undefined;
	#messageUpdates: RpcMessageUpdates = "full";
	#messageCount = 0;
	/** Ids of started, unfinished messages. External records (advisor cards, IRC) nest inside a streaming reply. */
	#openMessageIds: string[] = [];
	#manager: SessionManager | undefined;
	#unsubscribeJournal: (() => void) | undefined;
	#unsubscribePersistence: (() => void) | undefined;
	#endedMessages = new WeakMap<AgentMessage, { messageId: string; generation: number }>();
	#bindingGeneration = 0;
	readonly #pendingEntryMessages = new Map<string, string>();
	readonly #output: (frame: RpcProjectedSessionEventFrame) => void;

	constructor(output: (frame: RpcProjectedSessionEventFrame) => void) {
		this.#output = output;
	}

	/** Subscribe first, then publish identity before the host requests its history snapshot. */
	observeJournal(session: Pick<AgentSession, "sessionManager" | "subscribeMessagePersistenceSettled">): void {
		this.dispose();
		const manager = session.sessionManager;
		this.#manager = manager;
		this.#unsubscribeJournal = manager.subscribeJournal(event => this.#journalEvent(event));
		this.#unsubscribePersistence = session.subscribeMessagePersistenceSettled(message => {
			const ended = this.#endedMessages.get(message);
			this.#endedMessages.delete(message);
			if (!ended || ended.generation !== this.#bindingGeneration) return;
			const entryId = getMessageEntryId(message);
			if (!entryId) return;
			this.#pendingEntryMessages.set(entryId, ended.messageId);
			this.#associateEntry(entryId);
		});
		this.#emit({ type: "journal_state", reason: "snapshot", ...manager.getJournalIdentity() });
	}

	dispose(): void {
		this.#unsubscribeJournal?.();
		this.#unsubscribeJournal = undefined;
		this.#unsubscribePersistence?.();
		this.#unsubscribePersistence = undefined;
		this.#manager = undefined;
		this.#invalidateBinding();
	}

	#invalidateBinding(): void {
		this.#bindingGeneration++;
		this.#openMessageIds.length = 0;
		this.#pendingEntryMessages.clear();
		this.#endedMessages = new WeakMap();
	}

	#journalEvent(event: SessionJournalEvent): void {
		if (event.type === "journal_state" && event.reason === "identity") this.#invalidateBinding();
		this.#emit(event);
		if (event.type === "journal_entry") this.#associateEntry(event.entry.id);
	}

	#associateEntry(entryId: string): void {
		const messageId = this.#pendingEntryMessages.get(entryId);
		if (!messageId || !this.#manager?.isEntryDurable(entryId)) return;
		this.#pendingEntryMessages.delete(entryId);
		this.#emit({ type: "message_persisted", ...this.#manager.getJournalIdentity(), messageId, entryId });
	}

	#emit(frame: RpcProjectedSessionEventFrame): void {
		if (!this.#filter || this.#filter.has(frame.type)) this.#output(frame);
	}

	/** Forward only the listed event types; `null` forwards everything. Returns the active selection. */
	setFilter(events: readonly string[] | null, messageUpdates: RpcMessageUpdates = "full"): string[] | null {
		this.#filter = events === null ? undefined : new Set(events);
		this.#messageUpdates = messageUpdates;
		return this.#filter ? Array.from(this.#filter) : null;
	}

	forward(event: AgentSessionEvent): void {
		const generation = this.#bindingGeneration;
		const frame = this.#stamp(event);
		if (event.type === "message_end" && frame.type === "message_end" && this.#manager) {
			this.#endedMessages.set(getMessageEntrySource(event.message), { messageId: frame.messageId, generation });
		}
		if (this.#filter && !this.#filter.has(frame.type)) return;
		if (frame.type === "message_update" && this.#messageUpdates === "delta") {
			this.#output({
				...frame,
				message: { role: frame.message.role },
				assistantMessageEvent: withoutPartial(frame.assistantMessageEvent),
			});
			return;
		}
		this.#output(frame);
	}

	#stamp(event: AgentSessionEvent): RpcAgentSessionEventFrame {
		switch (event.type) {
			case "message_start": {
				const messageId = this.#mintMessageId();
				this.#openMessageIds.push(messageId);
				return { ...event, messageId };
			}
			case "message_update": {
				let messageId = this.#openMessageIds.at(-1);
				if (messageId === undefined) {
					messageId = this.#mintMessageId();
					this.#openMessageIds.push(messageId);
				}
				return { ...event, messageId };
			}
			case "message_end":
				return { ...event, messageId: this.#openMessageIds.pop() ?? this.#mintMessageId() };
			case "agent_end":
				// A run never leaves a message open; drop anything a dropped frame stranded.
				this.#openMessageIds.length = 0;
				return event;
			default:
				return event;
		}
	}

	#mintMessageId(): string {
		return `msg-${++this.#messageCount}`;
	}
}
