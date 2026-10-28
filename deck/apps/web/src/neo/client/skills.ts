import type { CreateSkillRequest, ListExtensionsResponse, ListMarketplaceResponse, ListSkillsResponse, MarketplaceCatalogEntry, MarketplaceUpdatesResponse, SkillDetailResponse, SkillSummary, UpdateSkillRequest } from "@npi-deck/protocol";
import { marketplaceApi } from "@/lib/marketplace-api";
import { skillsApi } from "@/lib/skills-api";
import { api } from "@/lib/api";
import { SOURCES } from "./source";

/** GET /api/skills/usage: usage per opaque skill id. Preview until telemetry lands. */
export interface SkillUsage { lastUsedAt: string | null; uses7d: number }
/** Skills and marketplace operations, with authoring restrictions enforced by the live API. */
export interface SkillsClient {
	list(): Promise<ListSkillsResponse>;
	detail(id: string): Promise<SkillDetailResponse>;
	create(input: CreateSkillRequest): Promise<SkillSummary>;
	update(id: string, input: UpdateSkillRequest): Promise<SkillSummary>;
	remove(id: string): Promise<unknown>;
	marketplace(): Promise<ListMarketplaceResponse>;
	install(entry: MarketplaceCatalogEntry, scope: "user" | "project"): Promise<unknown>;
	uninstall(entry: MarketplaceCatalogEntry): Promise<unknown>;
	upgrade(entry: MarketplaceCatalogEntry): Promise<unknown>;
	updates(refresh?: boolean): Promise<MarketplaceUpdatesResponse>;
	addSource(uri: string): Promise<unknown>;
	removeSource(name: string): Promise<unknown>;
	refreshSource(name: string): Promise<unknown>;
}
const live: SkillsClient = {
	...skillsApi,
	marketplace: marketplaceApi.list,
	install: (e, scope) => marketplaceApi.install({ name: e.name, marketplace: e.marketplace, scope }),
	uninstall: (e) => marketplaceApi.uninstall({ id: e.id, scope: e.installed?.scope }),
	upgrade: (e) => marketplaceApi.upgrade(e.id, { scope: e.installed?.scope }),
	updates: (refresh) => refresh ? marketplaceApi.checkForUpdates() : marketplaceApi.updates(),
	addSource: marketplaceApi.addMarketplace,
	removeSource: marketplaceApi.removeMarketplace,
	// The live endpoint refreshes every source, not an individual marketplace.
	refreshSource: () => marketplaceApi.refresh(),
};
const records = new Map<string, SkillDetailResponse>();
let market: ListMarketplaceResponse = { sources: [], catalog: [], installed: [] };
const preview: SkillsClient = {
	async list() { return { skills: [...records.values()] }; },
	async detail(id) { const record = records.get(id); if (!record) throw new Error("This skill was removed. Close the drawer and choose another."); return structuredClone(record); },
	async create(input) {
		if (records.has(input.name)) throw new Error("A skill with that name already exists. Choose another name.");
		const record: SkillDetailResponse = { id: input.name, name: input.name, dirName: input.name, provider: "native", providerLabel: "OMP", level: "user", skillPath: `preview/skills/${input.name}/SKILL.md`, enabled: true, editable: true, frontmatter: { name: input.name, description: input.description }, body: input.body, files: [], revision: crypto.randomUUID() };
		records.set(record.id, record); return record;
	},
	async update(id, input) { const record = await preview.detail(id); if (record.revision !== input.revision) throw new Error("This skill changed. Close and reopen it before saving."); const next = { ...record, body: input.body, frontmatter: { ...record.frontmatter, description: input.description }, revision: crypto.randomUUID() }; records.set(id, next); return next; },
	async remove(id) { records.delete(id); },
	async marketplace() { return structuredClone(market); },
	async install(entry, scope) { market = { ...market, catalog: market.catalog.map((e) => e.id === entry.id ? { ...e, installed: { scope, version: e.version ?? "1.0.0", installedAt: new Date().toISOString() } } : e) }; },
	async uninstall(entry) { market = { ...market, catalog: market.catalog.map((e) => e.id === entry.id ? { ...e, installed: undefined } : e) }; },
	async upgrade(entry) { await preview.install(entry, entry.installed?.scope ?? "user"); },
	async updates(refresh) { return { updates: [], refreshed: Boolean(refresh), refreshErrors: [], checkedAt: new Date().toISOString() }; },
	async addSource(uri) { const name = uri.split("/").filter(Boolean).at(-1) ?? uri; market.sources.push({ name, sourceType: uri.startsWith("/") ? "local" : "github", sourceUri: uri, updatedAt: new Date().toISOString() }); },
	async removeSource(name) { market.sources = market.sources.filter((s) => s.name !== name); market.catalog = market.catalog.filter((e) => e.marketplace !== name); },
	async refreshSource(name) { market.sources = market.sources.map((s) => s.name === name ? { ...s, updatedAt: new Date().toISOString() } : s); },
};
export const skills: SkillsClient = SOURCES.skills === "live" ? live : preview;

/** Commands are the server's executable slash-command inventory, not skills. */
export const listCommands = () => api.listSlashCommands();
/** Discoverable extensions, without importing or executing their code. */
export async function listExtensions(): Promise<ListExtensionsResponse> {
	const response = await fetch("/api/skills/extensions");
	if (!response.ok) throw new Error(`Could not load extensions. HTTP ${response.status}.`);
	return response.json() as Promise<ListExtensionsResponse>;
}

const usage = new Map<string, SkillUsage>();
/** Preview usage is stable per id across refetches, and never reaches the live backend. */
export async function skillUsage(ids: readonly string[]): Promise<Record<string, SkillUsage>> {
	if (SOURCES.skillsUsage === "live") { const response = await fetch("/api/skills/usage"); if (!response.ok) throw new Error("Could not load skill usage. Try again."); return response.json() as Promise<Record<string, SkillUsage>>; }
	for (const [i, id] of ids.entries()) if (!usage.has(id)) usage.set(id, { lastUsedAt: i === 3 ? null : new Date(Date.now() - [120, 45, 1440][i % 3]! * 60_000).toISOString(), uses7d: [12, 4, 7, 0][i % 4]! });
	return Object.fromEntries(ids.map((id) => [id, usage.get(id)!]));
}
