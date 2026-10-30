import { useState } from "react";
import type { ListMarketplaceResponse, MarketplaceCatalogEntry, MarketplaceUpdatesResponse } from "@npi-deck/protocol";
import { Check, Drawer, Empty, ErrorState, formatShortRelative, LabelCell, NeoBadge, NeoButton, NeoSelect, Notice, SearchInput, Table, Toolbar } from "@/components/neo";
import { skills } from "../../client/skills";

const capabilityLabels: Record<string, string> = { skills: "Skills", commands: "Commands", agents: "Agent templates", hooks: "Hooks", mcpServers: "MCP servers", lspServers: "Language servers" };
export function PluginActions({ entry, updates, act }: { entry: MarketplaceCatalogEntry; updates: MarketplaceUpdatesResponse | null; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
	const [choosing, setChoosing] = useState(false); const [scope, setScope] = useState<"user" | "project">("user");
	const hasUpdate = updates?.updates.some((u) => u.pluginId === entry.id && u.scope === entry.installed?.scope);
	return <span className="neo-skills-actions" onClick={(e) => e.stopPropagation()}>{entry.installed ? <>{hasUpdate ? <NeoButton size="sm" onClick={() => void act(() => skills.upgrade(entry))}>Upgrade</NeoButton> : null}<NeoButton size="sm" variant="ghost" onClick={() => void act(() => skills.uninstall(entry))}>Uninstall</NeoButton></> : choosing ? <><span className="neo-skills-scope" role="group" aria-label={`Install scope for ${entry.name}`}>{(["user", "project"] as const).map((value) => <NeoButton key={value} size="sm" variant={scope === value ? "primary" : "ghost"} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === "user" ? "User" : "Project"}</NeoButton>)}</span><NeoButton size="sm" variant="primary" onClick={() => void act(() => skills.install(entry, scope)).then((saved) => { if (saved) setChoosing(false); })}>Install</NeoButton><NeoButton size="sm" variant="ghost" onClick={() => setChoosing(false)}>Cancel</NeoButton></> : <NeoButton size="sm" onClick={() => setChoosing(true)}>Install</NeoButton>}</span>;
}
export function Marketplace({ data, updates, notice, onSources, act }: { data: ListMarketplaceResponse; updates: MarketplaceUpdatesResponse | null; notice: string | null; onSources: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
	const [q, setQ] = useState(""); const [category, setCategory] = useState("all"); const [selectedId, setSelectedId] = useState<string | null>(null);
	const [installedOnly, setInstalledOnly] = useState(false);
	// Installed packages remain manageable after their catalog source disappears.
	// Keep user and project installations separate so actions target the right scope.
	const installedIds = new Set(data.installed.map((entry) => entry.id));
	const entries: MarketplaceCatalogEntry[] = [
		...data.catalog.filter((entry) => !installedIds.has(entry.id)),
		...data.installed.map((installed) => ({
			...(data.catalog.find((entry) => entry.id === installed.id) ?? {
				id: installed.id, name: installed.name, marketplace: installed.marketplace,
				capabilities: {}, description: "Installed plugin. Its source catalog is unavailable.",
			}),
			installed,
		})),
	];
	const entryKey = (entry: MarketplaceCatalogEntry) => `${entry.id}:${entry.installed?.scope ?? "catalog"}`;
	const selected = entries.find((entry) => entryKey(entry) === selectedId);
	const visible = entries.filter((e) => (!installedOnly || e.installed) && (category === "all" || e.category === category) && `${e.name} ${e.description ?? ""} ${e.marketplace} ${(e.tags ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
	return <>{notice ? <Notice>{notice}</Notice> : null}{updates?.refreshErrors.map((e) => <Notice key={e.marketplace} tone="warn">Could not refresh {e.marketplace}. Compared its cached catalog. {e.error}</Notice>)}<Toolbar end={<Check checked={installedOnly} onChange={setInstalledOnly}>Installed only</Check>}><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search marketplace plugins" /><NeoSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{[...new Set(data.catalog.flatMap((e) => e.category ? [e.category] : []))].map((c) => <option key={c}>{c}</option>)}</NeoSelect></Toolbar>
		<Table rows={visible} rowKey={entryKey} onRowClick={(e) => setSelectedId(entryKey(e))} empty={<Empty title={data.sources.length === 0 && !data.installed.length ? "No marketplace added yet" : "No plugins match"} hint={data.sources.length === 0 && !data.installed.length ? "Add a source to browse the skills, commands and tools agents could install." : "Clear the search or choose another category."} action={data.sources.length === 0 ? <NeoButton onClick={onSources}>Add source</NeoButton> : undefined} />} columns={[
			{ key: "name", header: "Plugin", sort: (e) => e.name, render: (e) => <LabelCell primary={e.name} secondary={<span className="neo-mono">{e.marketplace}</span>} /> },
			{ key: "version", header: "Installed / latest", render: (e) => <span className="neo-mono">{e.installed?.version ?? "Not installed"} / {e.version ?? "Unknown"}</span> },
			{ key: "caps", header: "Contains", wrap: true, render: (e) => <span className="neo-skills-capabilities">{Object.entries(e.capabilities).filter(([, on]) => on).map(([key]) => capabilityLabels[key] ?? key).join(", ") || "Not specified"}</span> },
			{ key: "installed", header: "Installed", render: (e) => e.installed ? <NeoBadge>{e.installed.scope}</NeoBadge> : <span className="neo-dim">–</span> },
			{ key: "action", header: "Action", render: (e) => <PluginActions entry={e} updates={updates} act={act} /> },
		]} />
		{selected ? <Drawer open width={600} onClose={() => setSelectedId(null)} title={selected.name} subtitle={<span className="neo-mono">{selected.marketplace} · {selected.version ?? "unversioned"}</span>} footer={<PluginActions entry={selected} updates={updates} act={act} />}><div className="neo-skills-drawer-content"><p>{selected.description ?? "This plugin does not provide a description."}</p>{selected.homepage ? <a href={selected.homepage} target="_blank" rel="noreferrer" className="text-accent">Visit homepage</a> : null}<div className="neo-skills-chips">{[...(selected.keywords ?? []), ...(selected.tags ?? [])].map((k) => <NeoBadge key={k}>{k}</NeoBadge>)}</div></div></Drawer> : null}
	</>;
}
export function Sources({ data, act }: { data: ListMarketplaceResponse; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
	const [uri, setUri] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
	async function add() { setBusy(true); setError(null); try { if (await act(() => skills.addSource(uri.trim()))) setUri(""); else setError("Could not add this source. Check the URI and try again."); } finally { setBusy(false); } }
	return <><Table rows={data.sources} rowKey={(s) => s.name} empty={<Empty title="No sources yet" hint="Add a GitHub repository, catalog URL, or local catalog path below." />} columns={[
		{ key: "name", header: "Name", render: (s) => s.name }, { key: "type", header: "Type", render: (s) => <NeoBadge>{s.sourceType}</NeoBadge> }, { key: "uri", header: "URI", render: (s) => <span className="neo-mono">{s.sourceUri}</span> }, { key: "updated", header: "Updated", render: (s) => formatShortRelative(s.updatedAt) }, { key: "actions", header: "Actions", render: (s) => <div className="neo-skills-actions"><NeoButton size="sm" variant="ghost" title="The API refreshes every source" onClick={() => void act(() => skills.refreshSource(s.name))}>Refresh</NeoButton><NeoButton size="sm" variant="danger" onClick={() => void act(() => skills.removeSource(s.name))}>Remove</NeoButton></div> },
	]} /><form className="neo-skills-source-form" onSubmit={(e) => { e.preventDefault(); void add(); }}><label className="neo-skills-field">Add source<input className="neo-input neo-mono" placeholder="owner/repo, https://catalog.json, or /local/path" aria-label="Source URI" value={uri} onChange={(e) => setUri(e.target.value)} /></label><NeoButton type="submit" disabled={busy || !uri.trim()}>Add</NeoButton><p className="neo-dim">The source supplies its name from the catalog.</p></form>{error ? <ErrorState error={error} /> : null}</>;
}
