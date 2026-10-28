import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TelegramUpdate } from "./telegram.ts";
import { createHash, randomBytes } from "node:crypto";
import type { TelegramConversation, TelegramPairing } from "@npi-deck/protocol";

export interface ChatSessionMapping {
	chatId: string;
	sessionId: string;
	sessionFile?: string;
	cwd: string;
	createdAt: string;
	updatedAt: string;
}

interface MappingRow {
	chat_id: string;
	session_id: string;
	session_file: string | null;
	cwd: string;
	created_at: string;
	updated_at: string;
}

export class TelegramBridgeStore {
	private readonly db: Database;

	constructor(dbPath: string) {
		if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
		this.db = new Database(dbPath, { create: true, strict: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS telegram_chat_sessions (
				chat_id      TEXT PRIMARY KEY,
				session_id   TEXT NOT NULL,
				session_file TEXT,
				cwd          TEXT NOT NULL,
				created_at   TEXT NOT NULL,
				updated_at   TEXT NOT NULL
			)
		`);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS telegram_session_history (
				chat_id TEXT NOT NULL, session_id TEXT NOT NULL, session_file TEXT,
				cwd TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
				PRIMARY KEY (chat_id, session_id)
			);
			INSERT OR IGNORE INTO telegram_session_history SELECT * FROM telegram_chat_sessions;
			CREATE TABLE IF NOT EXISTS telegram_card_defaults (chat_id TEXT PRIMARY KEY, properties TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_pending_intake (update_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_pairing (hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_paired_users (id TEXT PRIMARY KEY, label TEXT NOT NULL, paired_at TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_conversations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_runtime (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS telegram_notifications (id TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
		`);
	}

	stageIntake(update: TelegramUpdate): void {
		this.db.query("INSERT OR IGNORE INTO telegram_pending_intake (update_id, payload) VALUES (?, ?)")
			.run(update.update_id, JSON.stringify(update));
	}

	pendingIntakes(): TelegramUpdate[] {
		return this.db.query<{ payload: string }, []>("SELECT payload FROM telegram_pending_intake ORDER BY update_id")
			.all().map(row => JSON.parse(row.payload) as TelegramUpdate);
	}

	completeIntake(updateId: number): void {
		this.db.query("DELETE FROM telegram_pending_intake WHERE update_id = ?").run(updateId);
	}

	get(chatId: string): ChatSessionMapping | undefined {
		const row = this.db
			.query<MappingRow, [string]>(
				"SELECT chat_id, session_id, session_file, cwd, created_at, updated_at FROM telegram_chat_sessions WHERE chat_id = ?",
			)
			.get(chatId);
		return row ? fromRow(row) : undefined;
	}

	upsert(mapping: ChatSessionMapping): void {
		this.db
			.query<unknown, [string, string, string | null, string, string, string]>(
				`INSERT INTO telegram_chat_sessions (chat_id, session_id, session_file, cwd, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET
				   session_id = excluded.session_id,
				   session_file = excluded.session_file,
				   cwd = excluded.cwd,
				   updated_at = excluded.updated_at`,
			)
			.run(
				mapping.chatId,
				mapping.sessionId,
				mapping.sessionFile ?? null,
				mapping.cwd,
				mapping.createdAt,
				mapping.updatedAt,
			);
		this.db.query(`INSERT INTO telegram_session_history VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(chat_id, session_id) DO UPDATE SET session_file = excluded.session_file, updated_at = excluded.updated_at`)
			.run(mapping.chatId, mapping.sessionId, mapping.sessionFile ?? null, mapping.cwd, mapping.createdAt, mapping.updatedAt);
	}

	delete(chatId: string): void {
		this.db.query<unknown, [string]>("DELETE FROM telegram_chat_sessions WHERE chat_id = ?").run(chatId);
	}

	list(chatId: string): ChatSessionMapping[] {
		return this.db.query<MappingRow, [string]>("SELECT * FROM telegram_session_history WHERE chat_id = ? ORDER BY updated_at DESC")
			.all(chatId).map(fromRow);
	}

	getProperties(chatId: string): Record<string, unknown> {
		const row = this.db.query<{ properties: string }, [string]>("SELECT properties FROM telegram_card_defaults WHERE chat_id = ?").get(chatId);
		return row ? JSON.parse(row.properties) as Record<string, unknown> : {};
	}

	setProperties(chatId: string, properties: Record<string, unknown>): void {
		this.db.query("INSERT INTO telegram_card_defaults VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET properties = excluded.properties")
			.run(chatId, JSON.stringify(properties));
	}

	createPairing(username?: string): TelegramPairing {
		const code = randomBytes(24).toString("base64url");
		const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
		this.db.transaction(() => {
			this.db.query("DELETE FROM telegram_pairing").run();
			this.db.query("INSERT INTO telegram_pairing VALUES (?, ?)").run(pairingHash(code), expiresAt);
		})();
		return { code, expiresAt, ...(username ? { url: `https://t.me/${username}?start=pair_${code}` } : {}) };
	}

	cancelPairing(): void { this.db.query("DELETE FROM telegram_pairing").run(); }

	consumePairing(code: string, userId: string, label: string): boolean {
		return this.db.transaction(() => {
			const found = this.db.query<{ hash: string }, [string, string]>("DELETE FROM telegram_pairing WHERE hash = ? AND expires_at > ? RETURNING hash")
				.get(pairingHash(code), nowIso());
			if (!found) return false;
			this.db.query("INSERT INTO telegram_paired_users VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, paired_at = excluded.paired_at")
				.run(userId, label, nowIso());
			return true;
		})();
	}

	pairedUsers(): Array<{ id: string; label: string; pairedAt: string }> {
		return this.db.query<{ id: string; label: string; pairedAt: string }, []>("SELECT id, label, paired_at AS pairedAt FROM telegram_paired_users ORDER BY paired_at").all();
	}

	isPaired(id: string): boolean {
		return !!this.db.query("SELECT 1 FROM telegram_paired_users WHERE id = ?").get(id);
	}

	unpair(id: string): void { this.db.query("DELETE FROM telegram_paired_users WHERE id = ?").run(id); }

	conversation(id: string): TelegramConversation | undefined {
		const row = this.db.query<{ value: string }, [string]>("SELECT value FROM telegram_conversations WHERE id = ?").get(id);
		return row ? JSON.parse(row.value) : undefined;
	}

	conversations(): TelegramConversation[] {
		return this.db.query<{ value: string }, []>("SELECT value FROM telegram_conversations").all()
			.map(row => JSON.parse(row.value) as TelegramConversation)
			.map(row => ({ ...row, sessionId: this.get(row.id)?.sessionId }))
			.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	}

	saveConversation(value: TelegramConversation): void {
		this.db.query("INSERT INTO telegram_conversations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(value.id, JSON.stringify(value));
	}

	runtime(): { username?: string; polledAt?: string; error?: string; configFingerprint?: string } {
		const row = this.db.query<{ value: string }, []>("SELECT value FROM telegram_runtime WHERE id = 1").get();
		return row ? JSON.parse(row.value) : {};
	}

	setRuntime(value: ReturnType<TelegramBridgeStore["runtime"]>): void {
		this.db.query("INSERT INTO telegram_runtime VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(JSON.stringify(value));
	}

	notificationSent(id: string): boolean {
		return !!this.db.query("SELECT 1 FROM telegram_notifications WHERE id = ?").get(id);
	}

	markNotificationSent(id: string): void {
		this.db.transaction(() => {
			this.db.query("INSERT OR IGNORE INTO telegram_notifications VALUES (?, ?)").run(id, nowIso());
			this.db.query("DELETE FROM telegram_notifications WHERE sent_at < ?").run(new Date(Date.now() - 7 * 86400_000).toISOString());
		})();
	}

	close(): void {
		// Cached statements belong to this connection.
		this.db.close(true);
	}
}

export function nowIso(): string {
	return new Date().toISOString();
}

function fromRow(row: MappingRow): ChatSessionMapping {
	return {
		chatId: row.chat_id,
		sessionId: row.session_id,
		...(row.session_file ? { sessionFile: row.session_file } : {}),
		cwd: row.cwd,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function pairingHash(code: string): string { return createHash("sha256").update(code).digest("hex"); }
