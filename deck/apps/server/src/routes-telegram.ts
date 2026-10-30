import { Hono } from "hono";
import * as path from "node:path";
import type { TelegramSetup } from "@npi-deck/protocol";
import { TelegramBridgeStore, nowIso } from "../../bridges/telegram/src/store.ts";
import { TelegramApi } from "../../bridges/telegram/src/telegram.ts";
import { parseAllowedChats, telegramConfigFingerprint } from "../../bridges/telegram/src/config.ts";
import { appendEnvAudit, commitManagedEnvUpdates, getDataDir, MANAGED_ENV_KEYS_LOADED } from "./env-store.ts";
import type { AgentBridge } from "./bridge/types.ts";
import type { BridgeSupervisor } from "./bridge-supervisor.ts";

const fields = { botToken: "TELEGRAM_BOT_TOKEN", allowedUsers: "TELEGRAM_ALLOWED_USERS", allowedGroups: "TELEGRAM_GROUP_ALLOWED_CHATS", requireMention: "TELEGRAM_REQUIRE_MENTION" } as const;
const locked = (key: string) => process.env[key] !== undefined && !MANAGED_ENV_KEYS_LOADED.has(key);

export function buildTelegramRouter(bridge: AgentBridge, supervisor: BridgeSupervisor): Hono {
	const app = new Hono();
	const store = () => new TelegramBridgeStore(process.env.TELEGRAM_BRIDGE_DB_PATH?.trim() || path.join(getDataDir(), "telegram-bridge.db"));
	const restartRequired = (db: TelegramBridgeStore) => supervisor.get("telegram").status === "running"
		&& !!db.runtime().configFingerprint && db.runtime().configFingerprint !== telegramConfigFingerprint();
	const setup = (db: TelegramBridgeStore): TelegramSetup => {
		const { configFingerprint: _fingerprint, ...runtime } = db.runtime();
		return {
			bridge: supervisor.get("telegram"), configured: !!process.env.TELEGRAM_BOT_TOKEN?.trim(),
			restartRequired: restartRequired(db),
			allowedUsers: process.env.TELEGRAM_ALLOWED_USERS ?? "", allowedGroups: process.env.TELEGRAM_GROUP_ALLOWED_CHATS ?? "",
			requireMention: !["0", "false", "no", "off"].includes(process.env.TELEGRAM_REQUIRE_MENTION?.trim().toLowerCase() ?? ""),
			lockedFields: Object.entries(fields).filter(([, key]) => locked(key)).map(([field]) => field),
			pairedUsers: db.pairedUsers(), conversations: db.conversations(), runtime,
		};
	};
	app.onError((err, c) => c.json({ error: err.message.replaceAll(process.env.TELEGRAM_BOT_TOKEN || "\0", "[redacted]") }, 400));
	app.get("/telegram", c => { const db = store(); try { return c.json(setup(db)); } finally { db.close(); } });
	app.put("/telegram/config", async c => {
		const body = await c.req.json<Record<string, unknown>>();
		const updates: Record<string, string> = {};
		for (const [field, key] of Object.entries(fields)) {
			if (body[field] === undefined) continue;
			if (locked(key)) throw new Error(`${field} is set by the launching environment. Change it there and restart the server.`);
			if (field === "requireMention") {
				if (typeof body[field] !== "boolean") throw new Error("requireMention must be a boolean.");
				updates[key] = String(body[field]);
			} else {
				if (typeof body[field] !== "string") throw new Error(`${field} must be text.`);
				updates[key] = body[field].trim();
			}
		}
		if (updates.TELEGRAM_ALLOWED_USERS && !/^\d+(?:[\s,]+\d+)*$/.test(updates.TELEGRAM_ALLOWED_USERS)) throw new Error("Allowed users must be numeric Telegram IDs, separated by commas.");
		if (updates.TELEGRAM_GROUP_ALLOWED_CHATS) parseAllowedChats(updates.TELEGRAM_GROUP_ALLOWED_CHATS);
		if (updates.TELEGRAM_BOT_TOKEN !== undefined && !/^\d+:[A-Za-z0-9_-]+$/.test(updates.TELEGRAM_BOT_TOKEN)) throw new Error("Enter the bot token supplied by BotFather.");
		await commitManagedEnvUpdates(updates);
		await appendEnvAudit("telegram-settings", Object.keys(updates));
		const db = store();
		try {
			if (updates.TELEGRAM_BOT_TOKEN !== undefined) { db.cancelPairing(); db.setRuntime({ ...db.runtime(), username: undefined }); }
			return c.json(setup(db));
		} finally { db.close(); }
	});
	app.post("/telegram/verify", async c => {
		const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
		if (!token) throw new Error("Save a bot token first.");
		const identity = await new TelegramApi(token, process.env.TELEGRAM_API_ORIGIN).getMe();
		const db = store();
		try { db.setRuntime({ ...db.runtime(), username: identity.username }); return c.json(identity); } finally { db.close(); }
	});
	app.post("/telegram/pairing", c => {
		if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) throw new Error("Save a bot token first.");
		const db = store();
		try {
			if (restartRequired(db)) return c.json({ error: "Restart the bridge to apply the saved connection before pairing." }, 409);
			return c.json(db.createPairing(db.runtime().username));
		} finally { db.close(); }
	});
	app.delete("/telegram/pairing", c => { const db = store(); try { db.cancelPairing(); return c.json({ ok: true }); } finally { db.close(); } });
	app.delete("/telegram/users/:id", c => { const db = store(); try { db.unpair(c.req.param("id")); return c.json(setup(db)); } finally { db.close(); } });
	app.patch("/telegram/conversations/:id", async c => {
		const body = await c.req.json<{ mode?: unknown; notify?: unknown; sessionId?: unknown }>();
		if (body.mode !== undefined && !["task", "capture", "chat"].includes(String(body.mode))) throw new Error("Choose task, capture or chat mode.");
		if (body.notify !== undefined && typeof body.notify !== "boolean") throw new Error("notify must be a boolean.");
		if (body.sessionId !== undefined && body.sessionId !== null && typeof body.sessionId !== "string") throw new Error("sessionId must be a session ID or null.");
		const db = store();
		try {
			const id = c.req.param("id");
			const conversation = db.conversation(id);
			if (!conversation) return c.json({ error: "Conversation not found. Send a message from Telegram first." }, 404);
			if (typeof body.sessionId === "string") {
				const session = (await bridge.listSessions({})).find(row => row.id === body.sessionId);
				if (!session) return c.json({ error: "Thread no longer exists. Refresh the thread list." }, 404);
				// Binding a retained transcript is metadata only. The bridge resumes it on the next /chat.
				db.upsert({ chatId: id, sessionId: session.id, sessionFile: session.path, cwd: session.cwd, createdAt: nowIso(), updatedAt: nowIso() });
			} else if (body.sessionId === null) db.delete(id);
			// Read again after the async session lookup so an arriving Telegram message is not overwritten.
			db.saveConversation({ ...db.conversation(id)!, ...(body.mode !== undefined ? { mode: body.mode as "task" | "capture" | "chat" } : {}), ...(body.notify !== undefined ? { notify: body.notify as boolean } : {}) });
			return c.json(setup(db));
		} finally { db.close(); }
	});
	return app;
}
