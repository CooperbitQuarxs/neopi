import type { ListSessionsResponse, TelegramConversation, TelegramPairing, TelegramSetup } from "@npi-deck/protocol";

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
	const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
	const payload = await response.json();
	if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
	return payload as T;
}

export const telegram = {
	get: () => request<TelegramSetup>("/api/telegram"),
	configure: (body: { botToken?: string; allowedUsers?: string; allowedGroups?: string; requireMention?: boolean }) => request<TelegramSetup>("/api/telegram/config", "PUT", body),
	verify: () => request<{ id: number; username: string }>("/api/telegram/verify", "POST"),
	pair: () => request<TelegramPairing>("/api/telegram/pairing", "POST"),
	cancelPairing: () => request("/api/telegram/pairing", "DELETE"),
	unpair: (id: string) => request<TelegramSetup>(`/api/telegram/users/${encodeURIComponent(id)}`, "DELETE"),
	conversation: (id: string, body: { mode?: TelegramConversation["mode"]; notify?: boolean; sessionId?: string | null }) => request<TelegramSetup>(`/api/telegram/conversations/${encodeURIComponent(id)}`, "PATCH", body),
	sessions: () => request<ListSessionsResponse>("/api/sessions"),
};
