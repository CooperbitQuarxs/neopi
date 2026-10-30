import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { buildTelegramRouter } from "../../../server/src/routes-telegram.ts";
import { MANAGED_ENV_KEYS_LOADED } from "../../../server/src/env-store.ts";
import type { AgentBridge } from "../../../server/src/bridge/types.ts";
import type { BridgeSupervisor } from "../../../server/src/bridge-supervisor.ts";
import { TelegramBridge } from "./index.ts";
import { TelegramBridgeStore } from "./store.ts";
import type { TelegramBridgeConfig } from "./config.ts";
import type { TelegramUpdate } from "./telegram.ts";

async function until(predicate: () => boolean | Promise<boolean>, timeout = 6000): Promise<void> {
	const end = Date.now() + timeout;
	while (!await predicate()) { if (Date.now() > end) throw new Error("Fixture condition timed out"); await Bun.sleep(20); }
}

test("pairing invitations are single-use, replaceable and cancellable", () => {
	const store = new TelegramBridgeStore(":memory:");
	try {
		const first = store.createPairing("fixture_bot");
		const second = store.createPairing();
		expect(store.consumePairing(first.code, "1", "old")).toBe(false);
		expect(store.consumePairing("invalid", "1", "bad")).toBe(false);
		expect(store.consumePairing(second.code, "7", "Captain")).toBe(true);
		expect(store.consumePairing(second.code, "8", "replay")).toBe(false);
		expect(store.isPaired("7")).toBe(true);
		store.unpair("7");
		expect(store.isPaired("7")).toBe(false);
		const cancelled = store.createPairing(); store.cancelPairing();
		expect(store.consumePairing(cancelled.code, "9", "cancelled")).toBe(false);
	} finally { store.close(); }
});

test("setup, pairing, chat routing, streaming, capture and attention use only fake HTTP and WS APIs", async () => {
	const root = mkdtempSync(join(tmpdir(), "telegram-integration-"));
	const keys = ["NPI_DECK_HOME", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS", "TELEGRAM_GROUP_ALLOWED_CHATS", "TELEGRAM_REQUIRE_MENTION", "TELEGRAM_BRIDGE_DB_PATH", "TELEGRAM_API_ORIGIN"];
	const old = new Map(keys.map(key => [key, process.env[key]]));
	const oldManaged = new Set(MANAGED_ENV_KEYS_LOADED);
	for (const key of keys) { delete process.env[key]; MANAGED_ENV_KEYS_LOADED.delete(key); }
	process.env.NPI_DECK_HOME = root;
	const updates: TelegramUpdate[] = [];
	const calls: Array<{ method: string; body: Record<string, any> }> = [];
	const captures: Array<Record<string, any>> = [];
	const prompts: Array<Record<string, any>> = [];
	const sockets = new Set<ServerWebSocket<undefined>>();
	const timers: Array<ReturnType<typeof setTimeout>> = [];
	const session = { id: "thread-a", path: "/fixture/thread-a.jsonl", cwd: "/fixture", title: "Release review", createdAt: "2026-01-01", updatedAt: "2026-01-02", messageCount: 2 };
	const supervisor = { get: () => ({ name: "telegram", label: "Telegram", status: "running", crashCount: 0, requiredEnv: ["TELEGRAM_BOT_TOKEN"], missingEnv: [] }) } as unknown as BridgeSupervisor;
	const router = new Hono().route("/api", buildTelegramRouter({ listSessions: async () => [session] } as unknown as AgentBridge, supervisor));
	const fixture = Bun.serve<undefined>({
		hostname: "127.0.0.1", port: 0,
		async fetch(request, server) {
			const url = new URL(request.url);
			if (url.pathname === "/ws" && server.upgrade(request, { data: undefined })) return undefined;
			if (url.pathname.startsWith("/bot")) {
				const method = url.pathname.split("/").pop()!;
				const body = await request.json() as Record<string, any>;
				calls.push({ method, body });
				let result: unknown = true;
				if (method === "getMe") result = { id: 999, username: "fixture_bot" };
				if (method === "getUpdates") { await Bun.sleep(30); result = updates.splice(0); }
				if (method === "sendMessage" || method === "editMessageText") result = { message_id: calls.length, chat: { id: body.chat_id }, text: body.text };
				return Response.json({ ok: true, result });
			}
			if (url.pathname === "/api/sessions") return Response.json(request.method === "POST" ? { sessionId: session.id, sessionFile: session.path, cwd: session.cwd } : { sessions: [session] });
			if (url.pathname === "/api/inbox" && request.method === "POST") {
				const capture = await request.json() as Record<string, any>;
				captures.push({ ...capture, key: request.headers.get("Idempotency-Key") });
				return Response.json({ ...capture, id: "capture-a" });
			}
			return router.fetch(request);
		},
		websocket: {
			open(socket) { sockets.add(socket); }, close(socket) { sockets.delete(socket); },
			message(socket, raw) {
				const frame = JSON.parse(String(raw));
				if (frame.type === "subscribe") socket.send(JSON.stringify({ type: "subscribed", sessionId: frame.sessionId, snapshot: {} }));
				if (frame.type === "prompt") {
					prompts.push(frame);
					socket.send(JSON.stringify({ type: "session_event", sessionId: frame.sessionId, event: { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "First streamed words" }] } } }));
					timers.push(setTimeout(() => {
						socket.send(JSON.stringify({ type: "session_event", sessionId: frame.sessionId, event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Final response " + "word ".repeat(900) }] } } }));
						socket.send(JSON.stringify({ type: "session_event", sessionId: frame.sessionId, event: { type: "agent_end" } }));
					}, 400));
				}
			},
		},
	});
	const origin = `http://127.0.0.1:${fixture.port}`;
	process.env.TELEGRAM_API_ORIGIN = origin;
	const request = async (path: string, method = "GET", body?: unknown) => fetch(`${origin}/api/telegram${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const enqueue = (text: string, user = 7, chat = 7, type = "private") => { const id = calls.length + updates.length + 1; updates.push({ update_id: id, message: { message_id: id, chat: { id: chat, type }, from: { id: user, first_name: "Captain" }, text } }); };
	let bridge: TelegramBridge | undefined;
	let running: Promise<void> | undefined;
	try {
		expect((await request("/config", "PUT", { botToken: "123:fixture", allowedUsers: "", allowedGroups: "", requireMention: true })).status).toBe(200);
		expect(JSON.stringify(await (await request("")).json())).not.toContain("123:fixture");
		expect((await request("/config", "PUT", { allowedUsers: "@username" })).status).toBe(400);
		expect((await request("/verify", "POST")).status).toBe(200);
		const invitation = await (await request("/pairing", "POST")).json() as { code: string; url: string };
		expect(invitation.url).toContain("https://t.me/fixture_bot?start=pair_");
		const config: TelegramBridgeConfig = { botToken: "123:fixture", allowedUserIds: new Set(), allowedChatIds: new Set(), requireMention: true, mentionPatterns: [], freeResponseChatIds: new Set(), freeResponseTopics: new Set(), allowedTopics: new Set(), ignoredTopics: new Set(), deckApiBase: origin, deckWsUrl: `${origin.replace("http", "ws")}/ws`, apiOrigin: origin, dbPath: join(root, "telegram-bridge.db"), defaultCwd: "/fixture", pollTimeoutSeconds: 1, editIntervalMs: 250 };
		bridge = new TelegramBridge(config); running = bridge.run();
		enqueue("/capture forbidden", 8, 8); enqueue(`/start pair_${invitation.code}`);
		await until(async () => (await (await request("")).json() as any).pairedUsers.length === 1);
		expect(captures).toHaveLength(0);
		expect((await request("/conversations/7", "PATCH", { mode: "chat", sessionId: "thread-a", notify: true })).status).toBe(200);
		enqueue("Continue the release review");
		await until(() => calls.some(call => call.method === "editMessageText" && call.body.text.startsWith("Final response")));
		expect(prompts[0]?.sessionId).toBe("thread-a");
		expect(calls.some(call => call.method === "editMessageText" && call.body.text === "First streamed words")).toBe(true);
		expect(calls.filter(call => ["sendMessage", "editMessageText"].includes(call.method)).every(call => call.body.text.length <= 4096)).toBe(true);
		enqueue("/capture Keep this idea");
		await until(() => captures.length === 1);
		expect(captures[0]?.kind).toBe("capture"); expect(captures[0]?.key).toMatch(/^telegram:7:\d+:capture$/);
		await until(() => sockets.size === 1);
		// The observer refreshes subscriptions every three seconds.
		await Bun.sleep(3100);
		const alert = JSON.stringify({ type: "ext_ui_dialog_open", sessionId: "thread-a", dialogId: "question-1", kind: "confirm", prompt: "Ship the release?" });
		for (const socket of sockets) socket.send(alert);
		await until(() => calls.some(call => call.method === "sendMessage" && call.body.text.startsWith("Needs you:")));
		for (const socket of sockets) socket.send(alert);
		await Bun.sleep(100);
		const attention = calls.filter(call => call.method === "sendMessage" && call.body.text.startsWith("Needs you:"));
		expect(attention).toHaveLength(1);
		expect(attention[0]?.body.text).toContain("Ship the release?");
		await request("/conversations/7", "PATCH", { mode: "capture", notify: false });
		enqueue("Ordinary capture"); await until(() => captures.length === 2);
		await request("/users/7", "DELETE");
		enqueue("/capture revoked"); enqueue(`/start pair_${invitation.code}`, 8, 8);
		await Bun.sleep(100);
		expect(captures).toHaveLength(2);
		expect((await (await request("")).json() as any).pairedUsers).toHaveLength(0);
		bridge.stop(); await running; running = undefined;
		const persisted = new TelegramBridgeStore(config.dbPath);
		expect(persisted.get("7")?.sessionId).toBe("thread-a");
		expect(persisted.conversation("7")?.mode).toBe("capture"); persisted.close();
	} finally {
		bridge?.stop(); if (running) await running;
		for (const timer of timers) clearTimeout(timer);
		await fixture.stop(true);
		for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
		MANAGED_ENV_KEYS_LOADED.clear(); for (const key of oldManaged) MANAGED_ENV_KEYS_LOADED.add(key);
		rmSync(root, { recursive: true, force: true });
	}
}, 15000);
