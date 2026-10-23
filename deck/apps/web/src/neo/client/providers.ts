import { useEffect, useSyncExternalStore } from "react";
import { PREVIEW_PROVIDERS, type ProviderExposure } from "./preview-data";
import { SOURCES } from "./source";

export type { ProviderExposure };
/** Provider exposure changes picker visibility, never whether inference is served. */
export interface ProvidersClient {
 list(): Promise<ProviderExposure[]>;
 setHidden(id: string, hidden: boolean): Promise<ProviderExposure[]>;
}
const VISIBILITY_KEY = "neodeck.provider-picker-visibility";
function savedVisibility(): Record<string, boolean> {
 try {
  const value: unknown = JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
 } catch { return {}; }
}
const visibility = savedVisibility();
const fixtures = PREVIEW_PROVIDERS.map(p => ({ ...p, hidden: visibility[p.id] ?? p.hidden }));
const preview: ProvidersClient = {
 async list() { return fixtures.map(p => ({ ...p })); },
 async setHidden(id, hidden) {
  const provider = fixtures.find(p => p.id === id);
  if (!provider) throw new Error("Provider not found. Reload the provider list.");
  provider.hidden = hidden;
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(Object.fromEntries(fixtures.map(p => [p.id, p.hidden])))); } catch { /* Storage can be unavailable in private browser contexts. */ }
  return this.list();
 },
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
 const response = await fetch(path, init);
 if (!response.ok) throw new Error(`Provider update failed (${response.status}). Reload and try again.`);
 return await response.json() as T;
}
const live: ProvidersClient = {
 async list() { return (await request<{providers: ProviderExposure[]}>("/api/providers")).providers; },
 async setHidden(id, hidden) {
  await request(`/api/providers/${encodeURIComponent(id)}`, { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({hidden}) });
  return this.list();
 },
};
const adapter = SOURCES.providers === "live" ? live : preview;
let snapshot: readonly ProviderExposure[] = SOURCES.providers === "preview" ? fixtures.map(p => ({...p})) : [];
const listeners = new Set<() => void>();
function publish(next: ProviderExposure[]): ProviderExposure[] {
 snapshot = next;
 for (const listener of listeners) listener();
 return next;
}
export const providers: ProvidersClient = {
 async list() { return publish(await adapter.list()); },
 async setHidden(id, hidden) { return publish(await adapter.setHidden(id, hidden)); },
};
let initialLoad: Promise<ProviderExposure[]> | null = null;
/** Shared reactive snapshot, so exposure edits also update mounted model pickers. */
export function useProviders(): readonly ProviderExposure[] {
 const value = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot);
 useEffect(() => {
  if (SOURCES.providers === "preview") return;
  initialLoad ??= providers.list();
  void initialLoad.catch(() => {});
 }, []);
 return value;
}
