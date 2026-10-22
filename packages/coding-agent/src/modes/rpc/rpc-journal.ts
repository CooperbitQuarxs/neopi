import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent, isRecord } from "@oh-my-pi/pi-utils";
import { getBlobsDir } from "@oh-my-pi/pi-utils/dirs";
import { BlobStore } from "../../session/blob-store";
import { walkSessionBranch } from "../../session/session-context";
import type { SessionEntry } from "../../session/session-entries";
import { loadSessionFile, resolveBlobRefsInEntriesSync } from "../../session/session-loader";
import type { SessionManager } from "../../session/session-manager";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 256;
const PAGE_BYTES = 768 * 1024;
const MAX_CURSOR_CHARS = 16 * 1024;

export type RpcJournalScope = "journal" | "branch";
export type RpcJournalDirection = "forward" | "backward";
export interface RpcJournalPageOptions {
	scope?: RpcJournalScope;
	direction?: RpcJournalDirection;
	cursor?: string;
	limit?: number;
}
export interface RpcJournalPage {
	entries: SessionEntry[];
	sessionId: string;
	sessionFile: string;
	leafId: string | null;
	totalEntries: number;
	nextCursor?: string;
}
export type RpcJournalErrorCode =
	| "invalid_request"
	| "invalid_cursor"
	| "stale_cursor"
	| "leaf_changed"
	| "legacy_history_identity_required"
	| "session_unavailable";
export class RpcJournalError extends Error {
	constructor(message: string, readonly code: RpcJournalErrorCode) {
		super(message);
		this.name = "RpcJournalError";
	}
}

interface JournalSnapshot {
	sessionId: string;
	sessionFile: string;
	leafId: string | null;
	entries: readonly SessionEntry[];
	resolveEntry?: (entry: SessionEntry) => void;
}
interface JournalCursor {
	version: 1;
	scope: RpcJournalScope;
	direction: RpcJournalDirection;
	sessionId: string;
	sessionFile: string;
	leafId: string | null;
	totalEntries: number;
	boundaryId: string | null;
	offset: number;
}

function decodeCursor(cursor: string): JournalCursor {
	const invalid = () => new RpcJournalError("Invalid native journal cursor", "invalid_cursor");
	if (typeof cursor !== "string" || !cursor.length || cursor.length > MAX_CURSOR_CHARS || !/^[A-Za-z0-9_-]+$/.test(cursor))
		throw invalid();
	const bytes = Buffer.from(cursor, "base64url");
	if (bytes.toString("base64url") !== cursor) throw invalid();
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw invalid();
	}
	if (!isRecord(value)) throw invalid();
	const { version, scope, direction, sessionId, sessionFile, leafId, totalEntries, boundaryId, offset } = value;
	if (
		version !== 1 || (scope !== "journal" && scope !== "branch") ||
		(direction !== "forward" && direction !== "backward") ||
		typeof sessionId !== "string" || !sessionId.length ||
		typeof sessionFile !== "string" || !sessionFile.length ||
		!(leafId === null || (typeof leafId === "string" && leafId.length > 0)) ||
		!(boundaryId === null || (typeof boundaryId === "string" && boundaryId.length > 0)) ||
		typeof totalEntries !== "number" || !Number.isSafeInteger(totalEntries) || totalEntries < 0 ||
		typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > totalEntries ||
		(totalEntries === 0) !== (boundaryId === null)
	) throw invalid();
	return { version, scope, direction, sessionId, sessionFile, leafId, totalEntries, boundaryId, offset };
}

/** Canonicalize synchronously so the live owner's identity cannot change across an await. */
function canonicalSessionFile(file: string): string {
	try {
		return fs.realpathSync(file);
	} catch (error) {
		if (!isEnoent(error)) throw error;
		return path.resolve(file);
	}
}

/** The snapshot borrows native arrays; consume the page before yielding to a session mutation. */
export function pageRpcJournal(snapshot: JournalSnapshot, options: RpcJournalPageOptions = {}): RpcJournalPage {
	const scope = options.scope ?? "journal";
	const direction = options.direction ?? "forward";
	const limit = options.limit ?? DEFAULT_LIMIT;
	if ((scope !== "journal" && scope !== "branch") || (direction !== "forward" && direction !== "backward"))
		throw new RpcJournalError("Invalid journal scope or direction", "invalid_request");
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
		throw new RpcJournalError(`Journal page limit must be between 1 and ${MAX_LIMIT}`, "invalid_request");
	const { entries, sessionId, sessionFile } = snapshot;
	let cursor: JournalCursor;
	if (options.cursor !== undefined) {
		cursor = decodeCursor(options.cursor);
		if (cursor.scope !== scope || cursor.direction !== direction)
			throw new RpcJournalError("Journal cursor scope or direction does not match the request", "invalid_cursor");
		if (cursor.sessionId !== sessionId || cursor.sessionFile !== sessionFile)
			throw new RpcJournalError("Native journal identity changed", "stale_cursor");
		if (scope === "branch" && cursor.leafId !== snapshot.leafId)
			throw new RpcJournalError("Native branch leaf changed", "leaf_changed");
		if (entries.length < cursor.totalEntries ||
			(cursor.totalEntries > 0 && entries[cursor.totalEntries - 1]?.id !== cursor.boundaryId))
			throw new RpcJournalError("Native journal prefix changed", "stale_cursor");
	} else {
		cursor = {
			version: 1, scope, direction, sessionId, sessionFile, leafId: snapshot.leafId,
			totalEntries: entries.length, boundaryId: entries.at(-1)?.id ?? null,
			offset: direction === "forward" ? 0 : entries.length,
		};
	}
	const page: SessionEntry[] = [];
	let bytes = 2;
	let offset = cursor.offset;
	while (page.length < limit && (direction === "forward" ? offset < cursor.totalEntries : offset > 0)) {
		const entry = entries[direction === "forward" ? offset : offset - 1];
		snapshot.resolveEntry?.(entry);
		const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8") + (page.length ? 1 : 0);
		if (page.length && bytes + entryBytes > PAGE_BYTES) break;
		page.push(entry);
		bytes += entryBytes;
		offset += direction === "forward" ? 1 : -1;
	}
	if (direction === "backward") page.reverse();
	const more = direction === "forward" ? offset < cursor.totalEntries : offset > 0;
	return {
		entries: page, sessionId, sessionFile, leafId: cursor.leafId, totalEntries: cursor.totalEntries,
		...(more ? { nextCursor: Buffer.from(JSON.stringify({ ...cursor, offset }), "utf8").toString("base64url") } : {}),
	};
}

export function readLiveJournalPage(manager: SessionManager, options: RpcJournalPageOptions = {}): RpcJournalPage {
	const file = manager.getSessionFile();
	if (!file) throw new RpcJournalError("Session has no native journal file", "session_unavailable");
	if (!manager.hasDurableEntryIds())
		throw new RpcJournalError("Legacy session has no durable entry identities", "legacy_history_identity_required");
	return pageRpcJournal({
		sessionId: manager.getSessionId(), sessionFile: canonicalSessionFile(file), leafId: manager.getLeafId(),
		entries: options.scope === "branch" ? manager.getBranchView() : manager.snapshotForReplication().entries,
	}, options);
}

/** Read persisted records without a SessionManager, writer lease, agent, or file migration. */
export async function readSessionJournalPage(file: string, options: RpcJournalPageOptions = {}): Promise<RpcJournalPage> {
	const sessionFile = canonicalSessionFile(file);
	const loaded = await loadSessionFile(sessionFile, undefined, { throwIfMissing: true });
	const header = loaded.entries[0];
	if (loaded.invalidHeader || !header || header.type !== "session" || loaded.malformedRecords > 0)
		throw new RpcJournalError("Session journal contains unreadable records", "session_unavailable");
	if ((header.version ?? 1) < 2)
		throw new RpcJournalError("Legacy session has no durable entry identities", "legacy_history_identity_required");
	const entries: SessionEntry[] = [];
	for (const entry of loaded.entries) {
		if (entry.type === "session") continue;
		if (!entry.id || !(entry.parentId === null || typeof entry.parentId === "string"))
			throw new RpcJournalError("Session entry has no durable identity", "legacy_history_identity_required");
		entries.push(entry);
	}
	const leafId = entries.at(-1)?.id ?? null;
	const selected = options.scope === "branch"
		? walkSessionBranch(leafId, new Map(entries.map(entry => [entry.id, entry])))
		: entries;
	const blobs = new BlobStore(getBlobsDir());
	return pageRpcJournal({
		sessionId: header.id, sessionFile, leafId, entries: selected,
		resolveEntry: entry => resolveBlobRefsInEntriesSync([entry], blobs),
	}, options);
}
