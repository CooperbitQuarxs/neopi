import type { McpArgInput, McpKeyRef, McpKeyValueInput, McpServerRow, McpServerScope, McpServerWriteRequest, McpTransport } from "@npi-deck/protocol";

export interface McpPairDraft {
	key: string;
	value: string;
	stored: boolean;
}

export interface McpArgDraft {
	text: string;
	keepIndex?: number;
	flag?: string;
}

export interface McpDraft {
	name: string;
	scope: McpServerScope;
	sourcePath?: string;
	transport: McpTransport;
	command: string;
	args: McpArgDraft[];
	cwd: string;
	url: string;
	urlKept: boolean;
	timeout: string;
	env: McpPairDraft[];
	headers: McpPairDraft[];
}

const pairsOf = (entries: McpKeyRef[]): McpPairDraft[] => entries.map(entry => ({ key: entry.key, value: "", stored: entry.set }));
const inputsOf = (pairs: McpPairDraft[]): McpKeyValueInput[] => pairs.filter(pair => pair.key.trim() !== "").map(pair => ({ key: pair.key.trim(), value: pair.stored ? null : pair.value }));

export function newMcpDraft(): McpDraft {
	return { name: "", scope: "user", transport: "stdio", command: "", args: [], cwd: "", url: "", urlKept: false, timeout: "", env: [], headers: [] };
}

export function mcpDraftOf(row: McpServerRow): McpDraft {
	const args: McpArgDraft[] = [];
	(row.args ?? []).forEach((arg, index) => {
		const previous = args[args.length - 1];
		// Keep a credential and the flag that hides it together, as NeoPi requires.
		if (arg.redacted && arg.display === "••••••" && previous?.keepIndex === undefined && previous?.text.startsWith("-")) {
			args[args.length - 1] = { text: previous.text, flag: previous.text, keepIndex: index };
		} else args.push(arg.redacted ? { text: arg.display, keepIndex: index } : { text: arg.display });
	});
	return {
		name: row.name, scope: row.scope ?? "user",
		...(row.scope !== undefined ? { sourcePath: row.sourcePath } : {}),
		transport: row.transport, command: row.command ?? "", args, cwd: row.cwd ?? "",
		url: row.urlRedacted ? "" : row.url ?? "", urlKept: row.urlRedacted === true,
		timeout: row.timeout === undefined ? "" : String(row.timeout), env: pairsOf(row.env), headers: pairsOf(row.headers),
	};
}

export function mcpWriteBody(draft: McpDraft): McpServerWriteRequest {
	const args: McpArgInput[] = draft.args.filter(arg => arg.keepIndex !== undefined || arg.text.trim() !== "").flatMap(arg => {
		if (arg.keepIndex === undefined) return [arg.text.trim()];
		return arg.flag === undefined ? [{ keepIndex: arg.keepIndex }] : [arg.flag, { keepIndex: arg.keepIndex }];
	});
	return {
		scope: draft.scope,
		...(draft.sourcePath !== undefined ? { sourcePath: draft.sourcePath } : {}),
		transport: draft.transport,
		...(draft.transport === "stdio"
			? { command: draft.command.trim(), args, cwd: draft.cwd.trim(), env: inputsOf(draft.env) }
			: { url: draft.urlKept ? null : draft.url.trim(), headers: inputsOf(draft.headers) }),
		timeout: draft.timeout.trim() === "" ? null : Number(draft.timeout),
	};
}

export function mcpTarget(row: McpServerRow): { scope: McpServerScope; sourcePath?: string } {
	return { scope: row.scope ?? "user", ...(row.scope !== undefined ? { sourcePath: row.sourcePath } : {}) };
}

export const MCP_DISABLED_REASON: Record<NonNullable<McpServerRow["disabledReason"]>, string> = {
	denylisted: "Disabled in the user mcp.json denylist.",
	"config-flag": "Its config sets enabled to false.",
	"extension-disabled": "Switched off in NeoPi's disabledExtensions setting.",
	"provider-disabled": "Its discovery provider is switched off in NeoPi.",
	"user-opt-in": "NeoPi loads this tool's home config only when the source is opted in.",
	shadowed: "A higher-priority source owns this name. This entry does not load.",
};
