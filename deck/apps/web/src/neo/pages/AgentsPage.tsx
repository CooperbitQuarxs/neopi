/**
 * Agents: templates and the instances made from them.
 *
 * A template is a definition (model, tools, prompt, provenance) and never has
 * a status. An instance is a running agent with its own conversation; Main is
 * one of them. There is no subagent or advisor kind here: who started an
 * instance is a relationship shown on it, not a type. See
 * ~/.cache/npi-canary/neodeck-pool/philosophy.md §1.
 */
import "./agents.css";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Dot, ErrorState, NeoButton, PageHeader, Segmented, Table, type Column } from "@/components/neo";
import { useStore } from "@/lib/store";
import { judgeClient } from "../client/agents";
import { agentCatalog, provenance, useAgentsRevision, type AgentCatalog, type AgentInstance, type AgentTemplate } from "../client/agentDefinitions";
import { PreviewChip } from "../components/PreviewChip";
import { NAV_ITEMS } from "../nav";
import { InstanceInspector } from "./agents/InstanceInspector";
import { AgentSection, InstanceTable } from "./agents/parts";
import { TemplatePage } from "./agents/TemplatePage";

type Origin = "all" | "deck" | "neopi";
type Scope = "active" | "all";

export function AgentsPage() {
	const item = NAV_ITEMS.find((i) => i.to === "/agents")!;
	const [params, setParams] = useSearchParams();
	const templateParam = params.get("template");
	const selected = params.get("instance");
	const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState<Origin>("all");
	const [scope, setScope] = useState<Scope>("active");
	const [judge, setJudge] = useState<string | null>(null);
	const revision = useAgentsRevision();
	const sessions = useStore((s) => s.sessionsById);
	const workers = useStore((s) => s.subagentsBySession);
	const request = useRef(0);

	const refresh = useCallback(async () => {
		const epoch = ++request.current;
		try {
			const next = await agentCatalog.load();
			if (epoch === request.current) { setCatalog(next); setError(null); }
		} catch (e) { if (epoch === request.current) setError(e instanceof Error ? e.message : String(e)); }
	}, []);
	useEffect(() => { void refresh(); }, [refresh, revision, sessions, workers]);
	useEffect(() => { judgeClient.status().then((s) => setJudge(s.reason), (e: unknown) => setJudge(e instanceof Error ? e.message : String(e))); }, []);

	const patch = useCallback((next: Record<string, string | null>) => setParams((prev) => {
		const p = new URLSearchParams(prev);
		for (const [k, v] of Object.entries(next)) if (v === null) p.delete(k); else p.set(k, v);
		return p;
	}), [setParams]);
	const select = useCallback((i: AgentInstance | null) => patch({ instance: i?.id ?? null }), [patch]);

	const templates = catalog?.templates ?? [];
	const instances = catalog?.instances ?? [];
	const instance = instances.find((i) => i.id === selected) ?? null;
	const shownTemplates = useMemo(() => templates.filter((t) => origin === "all" || (origin === "deck" ? t.source.format === "deck" : t.source.format !== "deck")), [templates, origin]);
	const shownInstances = useMemo(() => instances.filter((i) => scope === "all" || i.status === "running" || i.status === "idle"), [instances, scope]);

	const templateColumns: Column<AgentTemplate>[] = [
		{ key: "name", header: "Template", sort: (t) => t.name.toLowerCase(), render: (t) => <span className="neo-agents-tname"><strong>{t.name}</strong>{t.description ? <span className="neo-dim">{t.description}</span> : null}</span>, wrap: true },
		{ key: "from", header: "Defined in", sort: (t) => provenance(t), render: (t) => <span className="neo-dim">{provenance(t)}</span> },
		{ key: "model", header: "Model", render: (t) => <span className="neo-mono neo-agents-model">{t.model ?? "inherits"}</span> },
		{ key: "tools", header: "Tools", align: "right", sort: (t) => t.tools?.length ?? 0, render: (t) => <span className="neo-num neo-dim">{t.tools?.length ? t.tools.length : "default"}</span> },
		{ key: "running", header: "Instances", align: "right", sort: (t) => t.instanceCount, render: (t) => <span className="neo-num">{t.instanceCount ? `${t.instanceCount} running` : <span className="neo-dim">none running</span>}</span> },
	];

	const isNew = templateParam === "new";
	const template = templateParam && !isNew ? (templates.find((t) => t.id === templateParam) ?? null) : null;
	const detail = templateParam !== null;

	return (
		<div className="neo-agents-page" data-inspector={instance ? "open" : undefined}>
			<main className="neo-agents-main">
				{detail ? (
					catalog && !isNew && !template ? (
						<ErrorState error="That template isn't in the catalogue any more." onRetry={() => patch({ template: null })} />
					) : (
						<TemplatePage key={templateParam} template={template} isNew={isNew} instances={instances} templates={templates} selected={selected} onSelect={select} onBack={() => patch({ template: null })} onChanged={refresh} onSaved={(id) => patch({ template: id })} />
					)
				) : (
					<>
						<PageHeader
							title={item.label}
							description="An agent is a template; what runs is an instance of it. Main is an instance too."
							badge={<PreviewChip domains={["agentDefinitions", "agentSpawn"]} what="NeoPi's own definitions and starting agents from templates" />}
							actions={<NeoButton variant="primary" onClick={() => patch({ template: "new" })}><Plus size={14} /> New template</NeoButton>}
						/>
						{error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
						<AgentSection
							title="Templates"
							how="Definitions: a model, tools and a prompt, and the file or place each comes from. A template never runs; open one to start an instance."
							actions={<Segmented label="Defined in" options={[{ value: "all", label: "All" }, { value: "deck", label: "Deck" }, { value: "neopi", label: "NeoPi" }]} value={origin} onChange={setOrigin} />}
							legend={catalog?.errors.templates ? <span className="neo-dim">Deck templates unavailable: {catalog.errors.templates}</span> : agentCatalog.nativeDefinitionsPreview ? <span className="neo-dim">NeoPi's own definitions are preview data until NeoPi can list them (list_agent_definitions).</span> : null}
						>
							<Table columns={templateColumns} rows={shownTemplates} rowKey={(t) => t.id} onRowClick={(t) => patch({ template: t.id })} initialSort={{ key: "running", dir: "desc" }} dense empty={<span className="neo-dim">{origin === "deck" ? "No template written in the deck yet. New template makes one." : "No templates."}</span>} />
						</AgentSection>
						<AgentSection
							title="Instances"
							how="Agents that are running or ran, in every thread. Started by you means depth zero; otherwise it names the agent that started it."
							actions={<Segmented label="Show" options={[{ value: "active", label: "Active" }, { value: "all", label: "All" }]} value={scope} onChange={setScope} />}
							legend={<><span className="neo-agents-legend-item"><Dot tone="live" /> running</span><span className="neo-agents-legend-item"><Dot tone="ok" /> idle</span><span className="neo-agents-legend-item"><Dot /> done or cancelled</span><span className="neo-agents-legend-hint">{catalog?.errors.instances ? `Instances unavailable: ${catalog.errors.instances}` : "Select a row to inspect it"}</span></>}
						>
							<InstanceTable rows={shownInstances} all={instances} templates={templates} selected={selected} onSelect={select} empty={<span className="neo-dim">{scope === "active" ? "Nothing is running. Open a thread, or start an instance from a template." : "No instances yet."}</span>} />
						</AgentSection>
						<AgentSection title="Judge" how="One watcher over every session that flags stuck work and stops what wasn't sanctioned.">
							<p className="neo-dim neo-agents-judge-line">{judge ? `Not available: ${judge}` : "Checking…"}</p>
						</AgentSection>
					</>
				)}
			</main>
			{instance ? <InstanceInspector instance={instance} all={instances} templates={templates} onClose={() => select(null)} onChanged={refresh} /> : null}
		</div>
	);
}
