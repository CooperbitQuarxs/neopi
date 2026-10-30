import type {
	CreateInboxItemRequest,
	GraphRunRecord,
	InboxItem,
	InboxDestination,
	InboxHistoryEvent,
	InboxProposal,
	InboxReceipt,
	InboxRouting,
	InboxKind,
	ListInboxResponse,
	PromoteInboxItemRequest,
	PromoteInboxItemResponse,
	UpdateInboxItemRequest,
} from "@npi-deck/protocol";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${path}: ${body}`);
	}
	return (await res.json()) as T;
}

export const inboxApi = {
	routing(): Promise<InboxRouting> {
		return req<InboxRouting>("/inbox/routing");
	},
	updateRouting(body: Partial<Pick<InboxRouting["defaultFlow"], "enabled" | "repository">>): Promise<InboxRouting> {
		return req<InboxRouting>("/inbox/routing", { method: "PATCH", body: JSON.stringify(body) });
	},
	previewRouting(body: Pick<CreateInboxItemRequest, "kind" | "title" | "body">): Promise<GraphRunRecord> {
		return req<GraphRunRecord>("/inbox/routing/preview", { method: "POST", body: JSON.stringify(body) });
	},
	proposal(id: string): Promise<InboxProposal> {
		return req<InboxProposal>(`/inbox/${encodeURIComponent(id)}/proposal`);
	},
	history(id: string): Promise<{ events: InboxHistoryEvent[] }> {
		return req(`/inbox/${encodeURIComponent(id)}/history`);
	},
	file(id: string, destination: InboxDestination): Promise<{ receipt: InboxReceipt }> {
		return req(`/inbox/${encodeURIComponent(id)}/file`, { method: "POST", body: JSON.stringify({ destination }) });
	},
	previewIssue(id: string, repo: string): Promise<{ plan: { destination: InboxDestination; title: string; body: string } }> {
		return req(`/inbox/${encodeURIComponent(id)}/file`, { method: "POST", body: JSON.stringify({ destination: { kind: "issue", repo }, dryRun: true }) });
	},
	list(opts: { kind?: InboxKind; includeProcessed?: boolean } = {}): Promise<ListInboxResponse> {
		const q = new URLSearchParams();
		if (opts.kind) q.set("kind", opts.kind);
		if (opts.includeProcessed) q.set("includeProcessed", "1");
		const qs = q.toString();
		return req<ListInboxResponse>(`/inbox${qs ? `?${qs}` : ""}`);
	},
	create(body: CreateInboxItemRequest): Promise<InboxItem> {
		return req<InboxItem>("/inbox", { method: "POST", body: JSON.stringify(body) });
	},
	update(id: string, body: UpdateInboxItemRequest): Promise<InboxItem> {
		return req<InboxItem>(`/inbox/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	remove(id: string): Promise<{ ok: boolean }> {
		return req(`/inbox/${encodeURIComponent(id)}`, { method: "DELETE" });
	},
	promote(id: string, body: PromoteInboxItemRequest = {}): Promise<PromoteInboxItemResponse> {
		return req<PromoteInboxItemResponse>(`/inbox/${encodeURIComponent(id)}/promote`, {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
};
