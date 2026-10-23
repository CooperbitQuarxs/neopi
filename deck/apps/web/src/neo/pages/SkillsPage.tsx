import "./skills.css";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, Code2, Package, Plus, RefreshCw, Terminal, FolderOpen } from "lucide-react";
import type { ListExtensionsResponse, ListMarketplaceResponse, MarketplaceUpdatesResponse, SkillSummary, SlashCommand } from "@npi-deck/protocol";
import { AsyncView, Card, Check, Dot, Empty, ErrorState, formatShortRelative, LabelCell, NeoButton, NeoSelect, Notice, Page, PageHeader, SearchInput, Table, Toolbar } from "@/components/neo";
import { useStore } from "@/lib/store";
import { listCommands, listExtensions, skills, skillUsage, type SkillUsage } from "../client/skills";
import { PreviewChip } from "../components/PreviewChip";
import { Marketplace, Sources } from "./skills/Marketplace";
import { NewSkillDrawer, SkillDetail } from "./skills/SkillDrawers";

type Category = "skills" | "commands" | "extensions" | "plugins" | "sources";
const categories = [
	{ id: "skills", label: "Skills", icon: BookOpen, description: "Instructions an agent reads when a task calls for them. Open a skill to read its SKILL.md, or edit skills you own." },
	{ id: "commands", label: "Commands", icon: Terminal, description: "Slash commands you invoke in a conversation. Built-in actions and saved prompts are separate from skill instructions." },
	{ id: "extensions", label: "Extensions", icon: Code2, description: "Code modules and manifest bundles that add tools, hooks or context. This inventory shows what NeoPi discovers, not what every running session has loaded." },
	{ id: "plugins", label: "Plugins", icon: Package, description: "Installable packages from your marketplace catalogs. A plugin can bundle skills, commands, agent templates, hooks and tool servers." },
	{ id: "sources", label: "Sources", icon: FolderOpen, description: "Marketplace catalogs used to find and update plugins. These are package sources, not inference providers or NeoPi connections." },
] as const;

export function SkillsPage() {
	const [items, setItems] = useState<SkillSummary[] | null>(null);
	const [market, setMarket] = useState<ListMarketplaceResponse | null>(null);
	const [commands, setCommands] = useState<SlashCommand[] | null>(null);
	const [extensions, setExtensions] = useState<ListExtensionsResponse | null>(null);
	const [usage, setUsage] = useState<Record<string, SkillUsage>>({});
	const [errors, setErrors] = useState<Partial<Record<Category, string>>>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [q, setQ] = useState(""); const [provider, setProvider] = useState("all"); const [scope, setScope] = useState("all");
	const [enabled, setEnabled] = useState(false); const [showUsage, setShowUsage] = useState(false);
	const [creating, setCreating] = useState(false); const [updates, setUpdates] = useState<MarketplaceUpdatesResponse | null>(null);
	const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
	const [params, setParams] = useSearchParams(); const counter = useStore((s) => s.skillsChangeCounter);
	const requested = params.get("category");
	const category: Category = categories.some((c) => c.id === requested) ? requested as Category : "skills";
	const current = categories.find((c) => c.id === category)!;
	const refresh = useCallback(async () => {
		const failures: Partial<Record<Category, string>> = {};
		await Promise.all([
			skills.list().then((result) => { setItems(result.skills); }).catch((e: unknown) => { failures.skills = String(e); }),
			skills.marketplace().then(setMarket).catch((e: unknown) => { failures.plugins = String(e); failures.sources = String(e); }),
			listCommands().then((result) => setCommands(result.commands)).catch((e: unknown) => { failures.commands = String(e); }),
			listExtensions().then(setExtensions).catch((e: unknown) => { failures.extensions = String(e); }),
		]);
		setErrors(failures);
	}, []);
	useEffect(() => { void refresh(); }, [refresh, counter]);
	useEffect(() => { if (showUsage && items) void skillUsage(items.map((s) => s.id)).then(setUsage).catch((e: unknown) => setActionError(String(e))); }, [showUsage, items]);
	function changeCategory(next: Category) { setParams((prev) => { const value = new URLSearchParams(prev); value.set("category", next); value.delete("skill"); return value; }); setQ(""); }
	function select(id: string | null) { setParams((prev) => { const next = new URLSearchParams(prev); if (id) next.set("skill", id); else next.delete("skill"); return next; }); }
	async function act(fn: () => Promise<unknown>): Promise<boolean> { setBusy(true); setActionError(null); try { await fn(); await refresh(); return true; } catch (e) { setActionError(`The change was not saved. ${String(e)}`); return false; } finally { setBusy(false); } }
	async function checkUpdates() { setBusy(true); changeCategory("plugins"); setActionError(null); try { const result = await skills.updates(true); setUpdates(result); setNotice(result.updates.length ? `${result.updates.length} plugin updates available. Choose Upgrade to install an update.` : "No plugin updates found. Nothing was upgraded."); } catch (e) { setActionError(`Could not check for updates. ${String(e)}`); } finally { setBusy(false); } }
	const open = items?.find((s) => s.id === params.get("skill")) ?? items?.find((s) => s.name === params.get("skill"));
	const matches = (text: string) => text.toLowerCase().includes(q.toLowerCase());
	const visible = (items ?? []).filter((s) => (provider === "all" || s.provider === provider) && (scope === "all" || s.level === scope) && (!enabled || s.enabled) && matches(`${s.name} ${s.dirName} ${s.frontmatter.description ?? ""} ${(s.frontmatter.tags ?? []).join(" ")}`));
	const counts = { skills: items?.length, commands: commands?.length, extensions: extensions?.extensions.length, plugins: market ? new Set([...market.catalog.map((p) => p.id), ...market.installed.map((p) => p.id)]).size : undefined, sources: market?.sources.length };
	return <div className="h-full overflow-y-auto"><Page className="neo-skills-page">
		{open ? <SkillDetail key={open.id} skill={open} onClose={() => select(null)} onChanged={refresh} /> : <>
		<PageHeader title="Skills & tools" description="Manage what your agents can read, invoke and load." actions={<><NeoButton variant="ghost" onClick={() => void refresh()} disabled={busy} aria-label="Refresh inventory"><RefreshCw size={14} />Refresh</NeoButton><NeoButton variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New skill</NeoButton></>} />
		{actionError ? <ErrorState error={actionError} /> : null}
		<div className="neo-skills-manager">
			<nav className="neo-skills-categories" aria-label="Skill manager categories">{categories.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={category === id ? "page" : undefined} onClick={() => changeCategory(id)}><Icon size={17} /><span>{label}</span><span className="neo-skills-count">{counts[id] ?? "–"}</span></button>)}<Link to="/agents" className="neo-skills-agents-link">Agent templates live in Agents</Link></nav>
			<Card flush className="neo-skills-catalog">
				<div className="neo-skills-category-heading"><div><h2>{current.label}</h2><p>{current.description}</p></div>{category === "plugins" ? <NeoButton onClick={() => void checkUpdates()} disabled={busy}>{busy ? "Checking…" : "Check for updates"}</NeoButton> : null}</div>
				{errors[category] ? <ErrorState error={errors[category]!} onRetry={() => void refresh()} /> : null}
				{!errors[category] ? <>
				{category === "skills" ? <>
					<Toolbar end={<Check checked={enabled} onChange={setEnabled}>Enabled only</Check>}><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search skills" /><NeoSelect aria-label="Skill source" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="all">All skill sources</option>{[...new Map((items ?? []).map((s) => [s.provider, s.providerLabel])).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</NeoSelect><div className="neo-skills-scope" role="group" aria-label="Skill scope">{[["all", "All scopes"], ["user", "User"], ["project", "Project"]].map(([value, label]) => <NeoButton key={value} size="sm" variant={scope === value ? "primary" : "ghost"} aria-pressed={scope === value} onClick={() => setScope(value!)}>{label}</NeoButton>)}</div></Toolbar>
					<AsyncView data={items}>{() => <Table rows={visible} rowKey={(s) => s.id} onRowClick={(s) => select(s.id)} empty={<Empty title="No skills match" hint="Clear the filters, create a skill, or install a plugin that supplies skills." />} columns={[
						{ key: "name", header: "Skill", wrap: true, sort: (s: SkillSummary) => s.name, render: (s: SkillSummary) => <LabelCell primary={s.name} secondary={<span className="neo-skills-description">{s.frontmatter.description || s.dirName}</span>} /> },
						{ key: "source", header: "Source", render: (s: SkillSummary) => <LabelCell primary={s.providerLabel} secondary={s.level} /> },
						{ key: "enabled", header: "Availability", render: (s: SkillSummary) => <span className="neo-skills-enabled"><Dot tone={s.enabled ? "ok" : undefined} />{s.enabled ? "Enabled" : "Disabled"}</span> },
						{ key: "access", header: "Management", render: (s: SkillSummary) => s.editable ? "Editable here" : "Read-only" },
						...(showUsage ? [{ key: "used", header: "Last used · preview", render: (s: SkillSummary) => usage[s.id]?.lastUsedAt ? formatShortRelative(usage[s.id]!.lastUsedAt!) : "Unknown" }] : []),
					]} />}</AsyncView>
					<div className="neo-skills-foot"><p>Sources identify where instructions were discovered, not model providers. Shared agent directories means .agent/skills or .agents/skills, not running agents. Availability is managed by the owning source.</p><Check checked={showUsage} onChange={setShowUsage}>Show usage preview</Check>{showUsage ? <p className="neo-skills-used"><PreviewChip domains={["skillsUsage"]} what="Skill usage" />Example timestamps only. NeoPi does not expose reliable per-skill usage events yet.</p> : null}</div>
				</> : category === "commands" ? <><Toolbar><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search commands" /></Toolbar><AsyncView data={commands}>{(rows) => <Table rows={rows.filter((c) => matches(`${c.name} ${c.description ?? ""}`))} rowKey={(c) => c.name} empty={<Empty title="No commands match" hint="Saved commands are Markdown files in your agent commands directory or a project override." />} columns={[
					{ key: "name", header: "Command", width: "32%", wrap: true, sort: (c) => c.name, render: (c) => <code className="neo-skills-command">/{c.name}{c.argumentHint ? ` ${c.argumentHint}` : ""}</code> },
					{ key: "description", header: "Purpose", wrap: true, render: (c) => c.description || "No description supplied" },
					{ key: "scope", header: "Source", width: "18%", render: (c) => c.scope === "deck" ? "NeoDeck" : c.scope === "builtin" ? "NeoPi built-in" : `${c.scope} prompt` },
				]} />}</AsyncView><p className="neo-skills-foot">Invoke commands in a thread. Session extensions may register additional commands that appear only in that session.</p></> : category === "extensions" ? <><Toolbar><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search extensions" /></Toolbar><AsyncView data={extensions}>{(data) => <>{data.warnings.map((warning, i) => <Notice key={i} tone="warn">{warning}</Notice>)}<Table rows={data.extensions.filter((e) => matches(`${e.name} ${e.path} ${e.description ?? ""}`))} rowKey={(e) => e.id} empty={<Empty title="No extensions discovered" hint="NeoPi discovers configured JavaScript or TypeScript modules and supported extension bundles. Manage their files and configuration in NeoPi." />} columns={[
					{ key: "name", header: "Extension", sort: (e) => e.name, render: (e) => <LabelCell primary={e.name} secondary={e.description} /> },
					{ key: "kind", header: "Kind", render: (e) => e.kind === "module" ? "Code module" : "Manifest bundle" },
					{ key: "source", header: "Source", render: (e) => <LabelCell primary={e.providerLabel} secondary={e.level} /> },
					{ key: "path", header: "File location", wrap: true, render: (e) => <code className="neo-skills-path">{e.path}</code> },
				]} /></>}</AsyncView><p className="neo-skills-foot">Read-only inventory. Discovering an extension does not execute its code or change a running session.</p></> : <AsyncView data={market}>{(data) => category === "plugins" ? <Marketplace data={data} updates={updates} notice={notice} onSources={() => changeCategory("sources")} act={act} /> : <Sources data={data} act={act} />}</AsyncView>}
				</> : null}
			</Card>
		</div>
		</>}
		{creating ? <NewSkillDrawer onClose={() => setCreating(false)} onCreated={async (s) => { setCreating(false); setQ(""); setProvider("all"); setScope("all"); setEnabled(false); setParams({ category: "skills", skill: s.id }); await refresh(); }} /> : null}
	</Page></div>;
}
