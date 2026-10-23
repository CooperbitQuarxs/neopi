import type { InboxItem, InboxKind, InboxReceipt } from "@npi-deck/protocol";

import { getDb, id, nowIso } from "./index.ts";
import { enqueueInboxGraphEvents } from "./inbox-graph-events.ts";

interface Row {
	id: string;
	kind: string;
	title: string;
	body: string;
	source: string | null;
	created_at: string;
	processed_at: string | null;
}

const VALID_KINDS: ReadonlySet<InboxKind> = new Set([
	"email",
	"ticket",
	"idea",
	"decision",
	"investigation",
	"capture",
]);

function rowTo(r: Row): InboxItem {
	const out: InboxItem = {
		id: r.id,
		kind: r.kind as InboxKind,
		title: r.title,
		body: r.body,
		createdAt: r.created_at,
	};
	if (r.source !== null) out.source = r.source;
	if (r.processed_at !== null) out.processedAt = r.processed_at;
	const filing = getDb().query<{ receipt_json: string }, [string]>("SELECT receipt_json FROM inbox_filing_receipts WHERE item_id = ? ORDER BY filed_at DESC LIMIT 1").get(r.id);
	if (filing) out.filing = JSON.parse(filing.receipt_json) as InboxReceipt;
	return out;
}

export function listInbox(opts: { kind?: InboxKind; includeProcessed?: boolean }): InboxItem[] {
	const where: string[] = [];
	const args: string[] = [];
	if (opts.kind) {
		where.push("kind = ?");
		args.push(opts.kind);
	}
	if (!opts.includeProcessed) where.push("processed_at IS NULL");
	const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
	const rows = getDb()
		.query<Row, string[]>(
			`SELECT id, kind, title, body, source, created_at, processed_at
			 FROM inbox_items
			 ${clause}
			 ORDER BY created_at DESC`,
		)
		.all(...args) as Row[];
	return rows.map(rowTo);
}

export function getInbox(itemId: string): InboxItem | undefined {
	const row = getDb()
		.query<Row, [string]>(
			"SELECT id, kind, title, body, source, created_at, processed_at FROM inbox_items WHERE id = ?",
		)
		.get(itemId) as Row | null;
	return row ? rowTo(row) : undefined;
}

export function createInbox(input: {
	kind: InboxKind;
	title: string;
	body?: string;
	source?: string;
}): InboxItem {
	if (!VALID_KINDS.has(input.kind)) throw new Error(`invalid kind: ${input.kind}`);
	return getDb().transaction(() => {
		const itemId = `i_${id().toLowerCase().slice(0, 18)}`;
		const now = nowIso();
		getDb()
			.query<unknown, [string, string, string, string, string | null, string]>(
				`INSERT INTO inbox_items (id, kind, title, body, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(itemId, input.kind, input.title, input.body ?? "", input.source ?? null, now);
		const out = getInbox(itemId);
		if (!out) throw new Error("createInbox failed");
		enqueueInboxGraphEvents(out);
		return out;
	})();
}

/** Commit a delivery receipt atomically with the synchronous inbox mutation. */
export function inboxMutation<T>(scope: string, key: string | undefined, mutate: () => T): T {
	if (!key) return mutate();
	const db = getDb();
	return db.transaction(() => {
		const receipt = db.query<{ response_json: string }, [string, string]>(
			"SELECT response_json FROM inbox_mutation_receipts WHERE scope = ? AND request_key = ?",
		).get(scope, key);
		if (receipt) return JSON.parse(receipt.response_json) as T;
		const result = mutate();
		db.query("INSERT INTO inbox_mutation_receipts (scope, request_key, response_json) VALUES (?, ?, ?)")
			.run(scope, key, JSON.stringify(result));
		return result;
	})();
}

export function updateInbox(
	itemId: string,
	patch: { title?: string; body?: string; kind?: InboxKind; source?: string; processed?: boolean },
): InboxItem | undefined {
	const existing = getInbox(itemId);
	if (!existing) return undefined;
	if (patch.kind && !VALID_KINDS.has(patch.kind)) throw new Error(`invalid kind: ${patch.kind}`);
	const next = { ...existing, ...patch };
	const processedAt =
		patch.processed === true
			? nowIso()
			: patch.processed === false
				? null
				: existing.processedAt ?? null;
	getDb()
		.query<unknown, [string, string, string, string | null, string | null, string]>(
			`UPDATE inbox_items SET kind = ?, title = ?, body = ?, source = ?, processed_at = ? WHERE id = ?`,
		)
		.run(next.kind, next.title, next.body, next.source ?? null, processedAt, itemId);
	return getInbox(itemId);
}

export function deleteInbox(itemId: string): boolean {
	const r = getDb().query<unknown, [string]>("DELETE FROM inbox_items WHERE id = ?").run(itemId);
	return Number(r.changes ?? 0) > 0;
}
