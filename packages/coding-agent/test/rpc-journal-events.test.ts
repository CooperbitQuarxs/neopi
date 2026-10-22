import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { TempDir } from "@oh-my-pi/pi-utils";
import { RpcFrameDecoder, RpcFrameEncoder } from "../src/modes/rpc/rpc-frame";
import { RpcSessionEventForwarder } from "../src/modes/rpc/rpc-session-events";
import type { RpcProjectedSessionEventFrame } from "../src/modes/rpc/rpc-types";
import type { SessionJournalEvent } from "../src/session/session-journal-events";
import { SessionManager } from "../src/session/session-manager";
import { linkMessageEntrySource } from "../src/session/message-entry-ids";
import { MemorySessionStorage, type SessionStorageWriteOptions, type SessionStorageWriter } from "../src/session/session-storage";
import { makeAssistantMessage } from "./session-manager/helpers";

class RefusingStorage extends MemorySessionStorage {
	refuse = false;
	override writeTextSync(file: string, text: string, options?: SessionStorageWriteOptions): void {
		if (this.refuse) throw new Error("journal write refused");
		super.writeTextSync(file, text, options);
	}
	override appendSync(file: string, text: string): void {
		if (this.refuse) throw new Error("journal append refused");
		super.appendSync(file, text);
	}
}

class GatedStorage extends MemorySessionStorage {
	readonly publish = Promise.withResolvers<void>();
	override openWriter(file: string, options?: { flags?: "a" | "w"; onError?: (error: Error) => void }): SessionStorageWriter {
		const inner = super.openWriter(file, options);
		let queued = Promise.resolve();
		return {
			append: line => {
				queued = queued.then(async () => {
					await this.publish.promise;
					await inner.append(line);
				});
				return queued;
			},
			flush: async () => { await queued; await inner.flush(); },
			close: async () => { await queued; await inner.close(); },
			isOpen: () => inner.isOpen(),
			getError: () => inner.getError(),
		};
	}
}

function transport(manager: SessionManager) {
	const frames: RpcProjectedSessionEventFrame[] = [];
	const settled = new Set<(message: AgentMessage) => void>();
	const forwarder = new RpcSessionEventForwarder(frame => frames.push(frame));
	forwarder.observeJournal({
		sessionManager: manager,
		subscribeMessagePersistenceSettled(listener) {
			settled.add(listener);
			return () => settled.delete(listener);
		},
	});
	return { frames, forwarder, settle: (message: AgentMessage) => { for (const listener of settled) listener(message); } };
}

function committed(events: readonly SessionJournalEvent[]): string[] {
	return events.flatMap(event => event.type === "journal_entry" ? [event.entry.id] : []);
}

describe("native journal notifications", () => {
	test("append subscribers coexist, unsubscribe independently and cannot break other observers", async () => {
		const manager = SessionManager.inMemory();
		const first: string[] = [];
		const second: string[] = [];
		manager.subscribeEntries(() => { throw new Error("observer disconnected"); });
		const stop = manager.subscribeEntries(entry => first.push(entry.id));
		manager.subscribeEntries(entry => second.push(entry.id));
		const a = manager.appendCustomEntry("first");
		stop();
		const b = manager.appendCustomEntry("second");
		expect(first).toEqual([a]);
		expect(second).toEqual([a, b]);
		await manager.close();
	});

	test("failed writes stay unsaved, then recovery announces each confirmed entry once", async () => {
		await using dir = await TempDir.create("@journal-events-failure-");
		const storage = new RefusingStorage();
		const manager = SessionManager.create(dir.path(), dir.path(), storage);
		const events: SessionJournalEvent[] = [];
		manager.subscribeJournal(event => events.push(event));
		await manager.ensureOnDisk();
		storage.refuse = true;
		const id = manager.appendMessage(makeAssistantMessage());
		expect(manager.isEntryDurable(id)).toBe(false);
		expect(committed(events)).toEqual([]);
		await expect(manager.flush()).rejects.toThrow("journal append refused");
		storage.refuse = false;
		await manager.recoverPersistenceFromCurrentState();
		expect(manager.isEntryDurable(id)).toBe(true);
		expect(committed(events)).toEqual([id]);
		await manager.rewriteEntries();
		expect(committed(events)).toEqual([id]);
		await manager.close();
	});

	test("subscribing before a snapshot catches an append during snapshot delivery without polling", async () => {
		await using dir = await TempDir.create("@journal-events-snapshot-");
		const manager = SessionManager.create(dir.path(), dir.path(), new MemorySessionStorage());
		await manager.ensureOnDisk();
		const frames: RpcProjectedSessionEventFrame[] = [];
		let id = "";
		const forwarder = new RpcSessionEventForwarder(frame => {
			frames.push(frame);
			if (frame.type === "journal_state" && frame.reason === "snapshot") id = manager.appendCustomEntry("during snapshot");
		});
		forwarder.observeJournal({ sessionManager: manager, subscribeMessagePersistenceSettled: () => () => {} });
		expect(frames.filter(frame => frame.type === "journal_entry")).toMatchObject([{ entry: { id } }]);
		const original = manager.getJournalIdentity();
		manager.resetLeaf();
		expect(frames.at(-1)).toMatchObject({ type: "journal_state", reason: "leaf", ...original, leafId: null });
		manager.branch(id);
		expect(frames.at(-1)).toMatchObject({ type: "journal_state", reason: "leaf", leafId: id });
		await manager.newSession();
		expect(frames.at(-1)).toMatchObject({ type: "journal_state", reason: "identity", ...manager.getJournalIdentity() });
		expect(manager.getSessionId()).not.toBe(original.sessionId);
		forwarder.dispose();
		await manager.close();
	});

	test("live IDs bind only after persistence and an owner session change invalidates old messages", async () => {
		await using dir = await TempDir.create("@journal-events-identities-");
		const storage = new RefusingStorage();
		const manager = SessionManager.create(dir.path(), dir.path(), storage);
		await manager.ensureOnDisk();
		const live = transport(manager);
		const message = makeAssistantMessage();
		live.forwarder.forward({ type: "message_start", message });
		live.forwarder.forward({ type: "message_end", message });
		storage.refuse = true;
		const entryId = manager.appendMessage(message);
		live.settle(message);
		expect(live.frames.some(frame => frame.type === "message_persisted")).toBe(false);
		storage.refuse = false;
		await manager.recoverPersistenceFromCurrentState();
		expect(live.frames.filter(frame => frame.type === "message_persisted")).toEqual([
			{ type: "message_persisted", ...manager.getJournalIdentity(), messageId: "msg-1", entryId },
		]);
		const old = makeAssistantMessage();
		live.forwarder.forward({ type: "message_start", message: old });
		live.forwarder.forward({ type: "message_end", message: old });
		await manager.newSession();
		manager.appendMessage(old);
		live.settle(old);
		expect(live.frames.filter(frame => frame.type === "message_persisted")).toHaveLength(1);
		live.forwarder.dispose();
		await manager.close();
	});

	test("an observer attached after message start binds a display clone only after its queued append confirms", async () => {
		await using dir = await TempDir.create("@journal-events-deferred-");
		const storage = new GatedStorage();
		const manager = SessionManager.create(dir.path(), dir.path(), storage);
		await manager.ensureOnDisk();
		const live = transport(manager);
		const message = makeAssistantMessage();
		const display = { ...message, content: [{ type: "text" as const, text: "display-only secret" }] };
		linkMessageEntrySource(display, message);
		live.forwarder.forward({ type: "message_end", message: display });
		const entryId = manager.appendMessage(message);
		live.settle(message);
		expect(manager.isEntryDurable(entryId)).toBe(false);
		expect(live.frames.some(frame => frame.type === "journal_entry" || frame.type === "message_persisted")).toBe(false);
		storage.publish.resolve();
		await manager.flush();
		expect(live.frames.filter(frame => frame.type === "message_persisted")).toEqual([
			{ type: "message_persisted", ...manager.getJournalIdentity(), messageId: "msg-1", entryId },
		]);
		live.forwarder.dispose();
		await manager.close();
	});

	test("large canonical entries retain their full contents through existing v2 chunking", async () => {
		await using dir = await TempDir.create("@journal-events-large-");
		const manager = SessionManager.create(dir.path(), dir.path(), new MemorySessionStorage());
		await manager.ensureOnDisk();
		const encoder = new RpcFrameEncoder();
		encoder.setProtocolVersion(2);
		const decoder = new RpcFrameDecoder();
		const events: object[] = [];
		const unsubscribe = manager.subscribeJournal(event => {
			for (const line of encoder.encodeFrames(event)) {
				const decoded = decoder.push(JSON.parse(line));
				if (decoded) events.push(decoded);
			}
		});
		const text = "λ".repeat(800_000);
		const id = manager.appendCustomEntry("complete", { text });
		expect(events.find(event => "entry" in event)).toEqual({ type: "journal_entry", ...manager.getJournalIdentity(), entry: manager.getEntry(id) });
		unsubscribe();
		await manager.close();
	});
});
