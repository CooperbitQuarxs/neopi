import type { KbBacklinksResponse, KbFileResponse, KbGraphResponse, KbSearchResponse, KbTreeResponse } from "@npi-deck/protocol";
import { kbApi, type KbStatusResponse } from "@/lib/kb-api";
import { SOURCES } from "./source";

/** One note event from GET /api/kb/history?path=. Times are ISO 8601. */
export interface KnowledgeHistoryEntry {
	id: string;
	at: string;
	actor: string;
	kind: "wrote" | "asked" | "linked" | "committed";
	text: string;
}

export interface KnowledgeHistory { available: boolean; entries: KnowledgeHistoryEntry[] }

/** Read-only wiki contract. Changes are requested through an agent thread. */
export interface KnowledgeClient {
	tree(path?: string): Promise<KbTreeResponse>;
	file(path: string): Promise<KbFileResponse>;
	graph(): Promise<KbGraphResponse>;
	backlinks(path: string): Promise<KbBacklinksResponse>;
	search(query: string): Promise<KbSearchResponse>;
	status(): Promise<KbStatusResponse>;
	history(path: string): Promise<KnowledgeHistory>;
}

const historyAt = Date.now();
const previewHistory = async (path: string): Promise<KnowledgeHistory> => ({ available: false, entries: [
	{ id: `${path}:written`, at: new Date(historyAt - 2 * 86_400_000).toISOString(), actor: "chronicler", kind: "wrote", text: "from thread 'Draft 0.5 release notes'" },
	{ id: `${path}:asked`, at: new Date(historyAt - 5 * 86_400_000).toISOString(), actor: "lin", kind: "asked", text: "for a rewrite" },
] });

const live: KnowledgeClient = {
	...kbApi,
	history: SOURCES.knowledgeHistory === "preview" ? previewHistory : async (path) => {
		const response = await fetch(`/api/kb/history?path=${encodeURIComponent(path)}`);
		if (!response.ok) throw new Error(`Could not load note history (${response.status}).`);
		return (await response.json()) as KnowledgeHistory;
	},
};

const previewPath = "getting-started.md";
const previewBody = "# Getting started\n\nThe office keeps its shared notes here. Ask an agent to add what you learn.\n";
const preview: KnowledgeClient = {
	async tree(path = "") {
		return { path, dirs: [], files: path ? [] : [{ name: previewPath, path: previewPath, kind: "file", mtime: new Date(historyAt).toISOString() }] };
	},
	async file(path) {
		if (path !== previewPath) throw new Error("This note does not exist. Pick a note from the list.");
		return { path, absolutePath: `knowledge/${path}`, frontmatter: { title: "Getting started" }, body: previewBody, rawContent: previewBody, bodyForRender: previewBody, outgoingLinks: [], size: previewBody.length, mtime: new Date(historyAt).toISOString() };
	},
	async graph() {
		return { nodes: [{ id: previewPath, path: previewPath, title: "Getting started", dir: "", inbound: 0, outbound: 0, tags: [] }], edges: [], unresolvedCount: 0, totalNodes: 1, truncated: false };
	},
	async backlinks(path) { return { path, backlinks: [] }; },
	async search(query) {
		const matches = `${previewPath} ${previewBody}`.toLowerCase().includes(query.toLowerCase());
		return { query, results: matches ? [{ path: previewPath, title: "Getting started", dir: "", score: 1, matchKind: "body", snippet: "The office keeps its shared notes here. Ask an agent to add what you learn." }] : [], totalMatches: matches ? 1 : 0, truncated: false };
	},
	async status() { return { root: "knowledge/", exists: true, fileCount: 1 }; },
	history: previewHistory,
};

export const knowledge: KnowledgeClient = SOURCES.knowledge === "live" ? live : preview;
