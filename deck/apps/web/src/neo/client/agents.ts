/**
 * The agents wire: deck-authored templates, native instances and the
 * actions NeoPi permits on them, thread membership, and the judge's
 * availability. Nothing here is simulated; an unsupported action is an HTTP
 * error from the server. The template/instance catalogue the pages read is
 * agentDefinitions.ts.
 */
import type { JudgeEvent } from "./preview-data";
export type { AgentTemplate, AgentTemplateInput, AgentInstance, AgentCapabilities } from "@npi-deck/protocol";
import type { AgentTemplate as PersistedTemplate, AgentTemplateInput, AgentInstance, AgentCapabilities } from "@npi-deck/protocol";
async function request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
 const response = await fetch(`/api${route}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
 if (!response.ok) {
  const details = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(details.error ?? `HTTP ${response.status}`);
 }
 return await response.json() as T;
}

/** Native instances only. An unavailable action is never simulated locally. */
export const agentInstances = {
 list: async () => (await request<{ instances: AgentInstance[] }>("/agents/instances")).instances,
 forThread: async (id: string) => (await request<{ agents: AgentInstance[] }>(`/threads/${encodeURIComponent(id)}/agents`)).agents,
 steer: async (id: string, text: string): Promise<void> => { await request(`/agents/instances/${encodeURIComponent(id)}/steer`, "POST", { text }); },
 cancel: async (id: string): Promise<void> => { await request(`/agents/instances/${encodeURIComponent(id)}/cancel`, "POST"); },
 setModel: async (id: string, model: string): Promise<void> => { await request(`/agents/instances/${encodeURIComponent(id)}`, "PATCH", { model }); },
 capabilities: () => request<AgentCapabilities>("/agents/capabilities"),
};
/** Deck-authored definitions persist in SQLite. This is not native discovery. */
export const agentTemplates = {
 list: async () => (await request<{ templates: PersistedTemplate[] }>("/agents/templates")).templates,
 save: (template: AgentTemplateInput) => request<PersistedTemplate>(`/agents/templates/${encodeURIComponent(template.id)}`, "PUT", template),
 remove: async (id: string): Promise<void> => { await request(`/agents/templates/${encodeURIComponent(id)}`, "DELETE"); },
};
/** Thread transport exposes only actions backed by the attached native runtime. */
export const threadAgents = {
 list: agentInstances.forThread,
 send: async (id: string, to: string, text: string): Promise<void> => { await request(`/threads/${encodeURIComponent(id)}/send`, "POST", { to, text }); },
 remove: async (id: string, agentId: string): Promise<void> => { await request(`/threads/${encodeURIComponent(id)}/agents/${encodeURIComponent(agentId)}`, "DELETE"); },
 setModel: async (id: string, agentId: string, model: string): Promise<void> => { await request(`/threads/${encodeURIComponent(id)}/agents/${encodeURIComponent(agentId)}`, "PATCH", { model }); },
};
export const judgeClient = {
 status: () => request<{ available: false; reason: string }>("/judge"),
 events: async (limit = 50) => (await request<{ events: JudgeEvent[]; available: boolean; reason: string }>(`/judge/events?limit=${encodeURIComponent(limit)}`)).events,
 undoStop: async (id: string): Promise<void> => { await request(`/judge/events/${encodeURIComponent(id)}/undo`, "POST"); },
};
