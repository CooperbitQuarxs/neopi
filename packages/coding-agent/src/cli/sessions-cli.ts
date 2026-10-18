// Read-only host session discovery (#355).
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { textContent } from "@oh-my-pi/pi-tui/chat/transcript-entry";
import { getSessionsDir } from "@oh-my-pi/pi-utils/dirs";
import { readControlEntries, type ControlRegistryOptions } from "../control/registry";
import { filterSessionsForPicker, listAllSessions, listSessionsReadOnly } from "../session/session-listing";
import { loadSessionMessagesReadOnly } from "../session/session-loader";
import { sessionDirForCwd, worktreeSessionDirs } from "../session/session-paths";
import { loadPinnedSessionIds } from "../session/session-pins";
import { FileSessionStorage } from "../session/session-storage";

export interface SessionCatalogOptions {
	cwd?: string;
	sessionDirs?: string[];
	all?: boolean;
	/** Explicit roots keep SDK consumers and tests independent of process globals. */
	sessionsRoot?: string;
	agentDir?: string;
	controlRegistry?: ControlRegistryOptions;
}

async function canonicalPath(file: string): Promise<string> {
	return fs.realpath(file).catch(() => path.resolve(file));
}

export async function listSessionCatalog(options: SessionCatalogOptions = {}) {
	if (options.all && options.sessionDirs?.length) throw new Error("--all and --session-dir are mutually exclusive");
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const root = options.sessionsRoot ?? getSessionsDir();
	const storage = new FileSessionStorage();
	const pinned = await loadPinnedSessionIds(options.agentDir);
	let sessions;
	if (options.all) {
		sessions = await listAllSessions(storage, root);
	} else {
		const primary = sessionDirForCwd(cwd, root);
		const dirs = options.sessionDirs?.length
			? options.sessionDirs.map(dir => path.resolve(dir))
			: [primary, ...(await worktreeSessionDirs(cwd, primary))];
		sessions = (await Promise.all(dirs.map(dir => listSessionsReadOnly(dir, storage)))).flat();
	}
	const controls = new Map<string, { instanceId: string; role: "tui" | "rpc" | "acp" | "print"; pid: number }>();
	for (const { meta } of await readControlEntries(options.controlRegistry)) {
		if (!meta.sessionFile) continue;
		controls.set(await canonicalPath(meta.sessionFile), { instanceId: meta.instanceId, role: meta.role, pid: meta.pid });
	}
	const seen = new Set<string>();
	const rows = [];
	for (const session of filterSessionsForPicker(sessions, pinned).sort((a, b) => b.modified.getTime() - a.modified.getTime())) {
		const file = await canonicalPath(session.path);
		if (seen.has(file)) continue;
		seen.add(file);
		rows.push({
			path: path.resolve(session.path), id: session.id, cwd: session.cwd,
			title: session.title ?? null, parentSessionPath: session.parentSessionPath ?? null,
			created: session.created.toISOString(), modified: session.modified.toISOString(),
			messageCount: session.messageCount, status: session.status ?? null,
			firstMessage: session.firstMessage === "(no messages)" ? "" : session.firstMessage.trim().slice(0, 300),
			inUse: session.inUse ?? null, control: controls.get(file) ?? null,
		});
	}
	return { version: 1 as const, sessions: rows };
}

export async function readSessionCatalog(file: string, maxMessages?: number) {
	if (maxMessages !== undefined && (!Number.isSafeInteger(maxMessages) || maxMessages < 0)) {
		throw new Error("--max-messages must be a nonnegative integer");
	}
	const resolved = path.resolve(file);
	const storage = new FileSessionStorage();
	const info = (await listSessionsReadOnly(path.dirname(resolved), storage)).find(session => path.resolve(session.path) === resolved);
	if (!info) throw new Error(`Not a readable session file: ${resolved}`);
	const messages = [];
	for (const message of await loadSessionMessagesReadOnly(resolved)) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textContent(message.content, "\n\n");
		if (!text.trim()) continue;
		messages.push({ role: message.role, text, timestamp: new Date(message.timestamp).toISOString() });
	}
	const truncated = maxMessages !== undefined && messages.length > maxMessages;
	return {
		version: 1 as const,
		session: { path: resolved, id: info.id, cwd: info.cwd, title: info.title ?? null },
		messages: truncated ? messages.slice(messages.length - maxMessages!) : messages,
		truncated,
	};
}
