import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { encodeRpcFrame, RpcFrameDecoder, RpcFrameEncoder } from "../src/modes/rpc/rpc-frame";
import {
	pageRpcJournal, readLiveJournalPage, readSessionJournalPage,
	type RpcJournalDirection, type RpcJournalPageOptions,
} from "../src/modes/rpc/rpc-journal";
import { createRpcCommandHandler, type RpcCommandHandlerContext } from "../src/modes/rpc/rpc-mode";
import type { RpcCommand, RpcResponse } from "../src/modes/rpc/rpc-types";
import type { AgentSession } from "../src/session/agent-session";
import type { SessionEntry } from "../src/session/session-entries";
import { SessionManager } from "../src/session/session-manager";
import { FileSessionStorage, type WriteTextAtomicOptions } from "../src/session/session-storage";

function entry(index: number, size = 16): SessionEntry {
	return {
		type: "custom", id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null,
		timestamp: "2026-10-22T00:00:00.000Z", customType: "journal-test",
		data: { index, text: "λ".repeat(size) },
	};
}
function snapshot(entries: readonly SessionEntry[]) {
	return { entries, sessionId: "native-session", sessionFile: "/sessions/native.jsonl", leafId: entries.at(-1)?.id ?? null };
}
function expectFailure(run: () => unknown, code: string): void {
	try {
		run();
	} catch (error) {
		expect(error).toMatchObject({ code });
		return;
	}
	throw new Error(`Expected native journal failure: ${code}`);
}
function drain(entries: readonly SessionEntry[], direction: RpcJournalDirection): SessionEntry[] {
	const result: SessionEntry[] = [];
	let cursor: string | undefined;
	do {
		const page = pageRpcJournal(snapshot(entries), { cursor, direction, limit: 47 });
		if (direction === "forward") result.push(...page.entries);
		else result.unshift(...page.entries);
		cursor = page.nextCursor;
	} while (cursor);
	return result;
}
function handler(manager: SessionManager) {
	const context: Pick<RpcCommandHandlerContext, "session" | "success" | "error"> = {
		session: { sessionManager: manager } as unknown as AgentSession,
		success: (id, command, data) => ({ id, type: "response", command, success: true, data }) as RpcResponse,
		error: (id, command, error, code) => ({ id, type: "response", command, success: false, error, code }),
	};
	return createRpcCommandHandler(context as RpcCommandHandlerContext);
}
async function cli(root: string, args: string[]) {
	const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/cli.ts"), "sessions", "entries", "--json", ...args], {
		env: { ...process.env, PI_CODING_AGENT_DIR: path.join(root, "agent"), PI_CONTROL_DIR: path.join(root, "control"), OMP_PROFILE: "", PI_PROFILE: "" },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { stdout, stderr, code };
}

describe("canonical native journal pages", () => {
	test("both traversal directions retain more than 200 entries and every native record kind", () => {
		const entries = Array.from({ length: 347 }, (_, index) => entry(index));
		entries[19] = { ...entries[19], type: "compaction", summary: "Full summary", firstKeptEntryId: entries[10].id, tokensBefore: 500 };
		entries[20] = { type: "reset_boundary", id: entries[20].id, parentId: entries[19].id, timestamp: entries[20].timestamp };
		entries[21] = { type: "branch_summary", id: entries[21].id, parentId: entries[20].id, timestamp: entries[21].timestamp, fromId: entries[20].id, summary: "Branch summary" };
		entries[22] = { type: "message", id: entries[22].id, parentId: entries[21].id, timestamp: entries[22].timestamp, message: { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "complete tool output" }], isError: false, timestamp: 22 } };
		entries[23] = { type: "message", id: entries[23].id, parentId: entries[22].id, timestamp: entries[23].timestamp, message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }, { type: "text", text: "attachment caption" }], timestamp: 23 } };
		for (const direction of ["forward", "backward"] as const) expect(drain(entries, direction)).toEqual(entries);
		expect(pageRpcJournal(snapshot(entries)).entries).toHaveLength(100);
		expect(pageRpcJournal(snapshot(entries), { limit: 256 }).entries).toHaveLength(256);
	});

	test("journal walks pin their prefix and original leaf across appends and pointer-only leaf moves", () => {
		for (const direction of ["forward", "backward"] as const) {
			const entries = Array.from({ length: 5 }, (_, index) => entry(index));
			const first = pageRpcJournal(snapshot(entries), { direction, limit: 2 });
			entries.push(entry(5));
			const second = pageRpcJournal({ ...snapshot(entries), leafId: "elsewhere" }, { direction, cursor: first.nextCursor, limit: 2 });
			expect(second.totalEntries).toBe(5);
			expect(second.leafId).toBe("entry-4");
			expect(second.entries.map(e => e.id)).toEqual(direction === "forward" ? ["entry-2", "entry-3"] : ["entry-1", "entry-2"]);
			const last = pageRpcJournal(snapshot(entries), { direction, cursor: second.nextCursor, limit: 2 });
			expect(last.entries.map(e => e.id)).toEqual(direction === "forward" ? ["entry-4"] : ["entry-0"]);
			expect(last.nextCursor).toBeUndefined();
		}
	});

	test("identity, removed or replaced prefix boundaries and incompatible cursor options fail explicitly", () => {
		const entries = Array.from({ length: 5 }, (_, index) => entry(index));
		const original = snapshot(entries);
		const cursor = pageRpcJournal(original, { limit: 1 }).nextCursor;
		for (const changed of [
			{ ...original, sessionId: "another" }, { ...original, sessionFile: "/other.jsonl" },
			{ ...original, entries: entries.slice(0, 4) },
			{ ...original, entries: [...entries.slice(0, 4), entry(99)] },
		]) expectFailure(() => pageRpcJournal(changed, { cursor }), "stale_cursor");
		for (const options of [{ cursor, scope: "branch" }, { cursor, direction: "backward" }, { cursor: "broken!" }])
			expectFailure(() => pageRpcJournal(original, options as RpcJournalPageOptions), "invalid_cursor");
		for (const limit of [0, -1, 257, 1.5, Number.NaN])
			expectFailure(() => pageRpcJournal(original, { limit }), "invalid_request");
		for (const options of [{ scope: "unknown" }, { direction: "sideways" }])
			expectFailure(() => pageRpcJournal(original, options as RpcJournalPageOptions), "invalid_request");
		expect(pageRpcJournal(snapshot([]), { direction: "backward" })).toMatchObject({ entries: [], leafId: null, totalEntries: 0 });
	});

	test("soft budget counts UTF-8 bytes and a large entry is returned whole through v2 or rejected by v1", () => {
		const entries = [entry(0, 200_000), entry(1, 200_000), entry(2, 1_100_000), entry(3)];
		const first = pageRpcJournal(snapshot(entries), { limit: 256 });
		expect(first.entries).toEqual([entries[0]]);
		const second = pageRpcJournal(snapshot(entries), { cursor: first.nextCursor });
		expect(second.entries).toEqual([entries[1]]);
		const large = pageRpcJournal(snapshot(entries), { cursor: second.nextCursor });
		expect(large.entries).toEqual([entries[2]]);
		const frame = { type: "response", command: "get_entries_page", success: true, data: large };
		expect(JSON.parse(encodeRpcFrame(frame))).toMatchObject({ success: false, error: "RPC response exceeded the transport limit" });
		const encoder = new RpcFrameEncoder();
		encoder.setProtocolVersion(2);
		const decoder = new RpcFrameDecoder();
		const decoded: object[] = [];
		for (const line of encoder.encodeFrames(frame)) {
			const result = decoder.push(JSON.parse(line));
			if (result) decoded.push(result);
		}
		expect(decoded).toEqual([frame]);
		const backward = pageRpcJournal(snapshot(entries), { direction: "backward", limit: 256 });
		expect(backward.entries).toEqual([entries[3]]);
		const largeBackward = pageRpcJournal(snapshot(entries), { direction: "backward", cursor: backward.nextCursor });
		expect(largeBackward.entries).toEqual([entries[2]]);
	});

	test("native branch selection excludes abandoned entries and leaf moves fail with a wire code", async () => {
		await using dir = await TempDir.create("@rpc-journal-branch-");
		const manager = SessionManager.create(dir.path(), dir.path());
		try {
			const root = manager.appendCustomEntry("root");
			const abandoned = manager.appendCustomEntry("abandoned");
			manager.branch(root);
			const branch = manager.branchWithSummary(root, "Kept branch summary");
			const leaf = manager.appendCustomEntry("selected");
			const read = handler(manager);
			const response = await read({ type: "get_entries_page", scope: "branch", direction: "backward", limit: 1 });
			if (!response.success || response.command !== "get_entries_page") throw new Error("Native page failed");
			expect(response.data.entries.map(e => e.id)).toEqual([leaf]);
			expect(response.data.totalEntries).toBe(3);
			expect(readLiveJournalPage(manager).entries.map(e => e.id)).toEqual([root, abandoned, branch, leaf]);
			const branchPage = readLiveJournalPage(manager, { scope: "branch", direction: "backward", cursor: response.data.nextCursor });
			expect(branchPage.entries.map(e => e.id)).toEqual([root, branch]);
			manager.branch(abandoned);
			expect(await read({ type: "get_entries_page", scope: "branch", direction: "backward", cursor: response.data.nextCursor })).toMatchObject({ success: false, code: "leaf_changed" });
			const appendCursor = readLiveJournalPage(manager, { scope: "branch", limit: 1 }).nextCursor;
			manager.appendCustomEntry("new-leaf");
			expect(await read({ type: "get_entries_page", scope: "branch", cursor: appendCursor })).toMatchObject({ success: false, code: "leaf_changed" });
			expect(await read({ type: "get_entries_page", cursor: "bad!" })).toMatchObject({ success: false, code: "invalid_cursor" });
			const oldSessionCursor = readLiveJournalPage(manager, { limit: 1 }).nextCursor;
			await manager.newSession();
			expect(await read({ type: "get_entries_page", cursor: oldSessionCursor })).toMatchObject({ success: false, code: "stale_cursor" });
		} finally { await manager.close(); }
	});

	test("CLI and RPC agree beyond 200 entries while a writer owns the file, without modifying files", async () => {
		await using dir = await TempDir.create("@rpc-journal-cli-");
		const manager = SessionManager.create(dir.path(), path.join(dir.path(), "sessions"));
		try {
			const root = manager.appendMessage({ role: "user", content: "oldest retained message", timestamp: 1 });
			for (let index = 0; index < 305; index++) manager.appendCustomEntry("history", { index });
			manager.appendCompaction("complete summary", "short summary", root, 100_000);
			manager.appendResetBoundary();
			manager.appendMessage({ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "raw output" }], isError: false, timestamp: 2 });
			await manager.ensureOnDisk();
			await manager.flush();
			const file = manager.getSessionFile()!;
			const bytes = await Bun.file(file).text();
			const files = (await fs.readdir(path.dirname(file))).sort();
			const read = handler(manager);
			for (const scope of ["journal", "branch"] as const) {
				let cursor: string | undefined;
				let count = 0;
				do {
					const request: RpcCommand = { type: "get_entries_page", scope, direction: "backward", limit: 256, cursor };
					const response = await read(request);
					if (!response.success || response.command !== "get_entries_page") throw new Error("RPC journal read failed");
					const command = await cli(dir.path(), [file, "--scope", scope, "--direction", "backward", "--limit", "256", ...(cursor ? ["--cursor", cursor] : [])]);
					expect(command.code).toBe(0);
					expect(command.stderr).toBe("");
					expect(JSON.parse(command.stdout)).toEqual(JSON.parse(JSON.stringify(response.data)));
					count += response.data.entries.length;
					cursor = response.data.nextCursor;
				} while (cursor);
				expect(count).toBe(309);
			}
			expect(await Bun.file(file).text()).toBe(bytes);
			expect((await fs.readdir(path.dirname(file))).sort()).toEqual(files);
			const error = await cli(dir.path(), [file, "--cursor", "bad!"]);
			expect(error.code).toBe(1);
			expect(JSON.parse(error.stdout)).toMatchObject({ error: { code: "invalid_cursor", message: expect.any(String) } });
		} finally { await manager.close(); }
	}, 30_000);

	test("stopped legacy and malformed journals fail without inventing IDs or rewriting bytes", async () => {
		await using dir = await TempDir.create("@rpc-journal-legacy-");
		const file = path.join(dir.path(), "legacy.jsonl");
		const source = `${JSON.stringify({ type: "session", id: "old", cwd: dir.path(), timestamp: "2020-01-01T00:00:00Z" })}\n${JSON.stringify({ type: "message", message: { role: "user", content: "no native id", timestamp: 1 } })}\n`;
		await Bun.write(file, source);
		await expect(readSessionJournalPage(file)).rejects.toMatchObject({ code: "legacy_history_identity_required" });
		const result = await cli(dir.path(), [file]);
		expect(result.code).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "legacy_history_identity_required" } });
		expect(await Bun.file(file).text()).toBe(source);
		class RefusingStorage extends FileSessionStorage {
			refuse = true;
			override async writeTextAtomic(file: string, text: string, options?: WriteTextAtomicOptions): Promise<void> {
				if (this.refuse) throw new Error("Journal disk refused the write");
				await super.writeTextAtomic(file, text, options);
			}
		}
		const storage = new RefusingStorage();
		const manager = await SessionManager.open(file, dir.path(), storage, { suppressBreadcrumb: true });
		try {
			expect(await handler(manager)({ type: "get_entries_page" })).toMatchObject({ success: false, code: "legacy_history_identity_required" });
			expect(await Bun.file(file).text()).toBe(source);
			await expect(manager.ensureOnDisk()).rejects.toThrow("Journal disk refused the write");
			expect(await handler(manager)({ type: "get_entries_page" })).toMatchObject({ success: false, code: "legacy_history_identity_required" });
			expect(await Bun.file(file).text()).toBe(source);
			storage.refuse = false;
			await manager.recoverPersistenceFromCurrentState();
			const persisted = await readSessionJournalPage(file);
			expect(readLiveJournalPage(manager)).toEqual(persisted);
			expect(persisted.entries[0]?.id).toBeDefined();
		} finally { await manager.close(); }
		const malformed = path.join(dir.path(), "malformed.jsonl");
		await Bun.write(malformed, `${JSON.stringify({ type: "session", version: 3, id: "broken", cwd: dir.path(), timestamp: "2020-01-01T00:00:00Z" })}\n{broken\n`);
		await expect(readSessionJournalPage(malformed)).rejects.toMatchObject({ code: "session_unavailable" });
	});
});
