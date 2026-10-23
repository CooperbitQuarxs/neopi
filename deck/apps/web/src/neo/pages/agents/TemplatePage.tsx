import { Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BackButton, ErrorState, NeoButton, Segmented } from "@/components/neo";
import { agentCatalog, isEditable, isPreviewTemplate, provenance, type AgentInstance, type AgentTemplate, type AgentTemplateInput } from "../../client/agentDefinitions";
import { ModelPicker } from "../../components/ModelPicker";
import { AgentSection, InstanceTable } from "./parts";

const EFFORTS = ["inherit", "minimal", "low", "medium", "high", "xhigh"] as const;
type Effort = (typeof EFFORTS)[number];

function blank(): AgentTemplateInput {
	return { id: `tpl_${crypto.randomUUID().slice(0, 8)}`, name: "", description: "", model: "@default", thinking: undefined, tools: [], systemPrompt: "", preset: undefined };
}

/**
 * One template, full width. A template is configuration and provenance: it
 * never has a status. Its instances are listed below it; starting a new one
 * is the only way a template "runs".
 */
export function TemplatePage({ template, isNew, instances, templates, selected, onSelect, onBack, onChanged, onSaved }: {
	template: AgentTemplate | null;
	isNew: boolean;
	instances: readonly AgentInstance[];
	templates: readonly AgentTemplate[];
	selected: string | null;
	onSelect: (i: AgentInstance) => void;
	onBack: () => void;
	onChanged: () => Promise<void>;
	onSaved: (id: string) => void;
}) {
	const editable = isNew || (template !== null && isEditable(template));
	const initial = useMemo<AgentTemplateInput>(() => (template ? { id: template.id, name: template.name, description: template.description ?? "", model: template.model, thinking: template.thinking, tools: template.tools ?? [], systemPrompt: template.systemPrompt ?? "", preset: template.preset } : blank()), [template]);
	const [draft, setDraft] = useState<AgentTemplateInput>(initial);
	const [toolsText, setToolsText] = useState((initial.tools ?? []).join(", "));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [label, setLabel] = useState("");
	const [task, setTask] = useState("");
	useEffect(() => { setDraft(initial); setToolsText((initial.tools ?? []).join(", ")); setError(null); }, [initial]);

	const dirty = editable && (JSON.stringify({ ...draft, tools: splitTools(toolsText) }) !== JSON.stringify({ ...initial, tools: initial.tools ?? [] }));
	const mine = instances.filter((i) => template && i.templateId === template.id);

	async function run(action: () => Promise<void>): Promise<void> {
		setBusy(true); setError(null);
		try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
	}
	function save(): void {
		if (!draft.name.trim()) { setError("Give the template a name."); return; }
		void run(async () => { const saved = await agentCatalog.save({ ...draft, name: draft.name.trim(), tools: splitTools(toolsText) }); await onChanged(); onSaved(saved.id); });
	}
	function spawn(): void {
		if (!template) return;
		void run(async () => {
			const created = await agentCatalog.spawn({ templateId: template.id, label: label.trim() || template.name, task: task.trim() || undefined }, templates);
			setLabel(""); setTask("");
			await onChanged();
			onSelect(created);
		});
	}
	const set = <K extends keyof AgentTemplateInput>(key: K, value: AgentTemplateInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
	const effort: Effort = (draft.thinking as Effort | undefined) ?? "inherit";

	return (
		<div className="neo-agents-detail">
			<div className="neo-agents-detail-top">
				<BackButton onClick={onBack}>Agents</BackButton>
				<div className="neo-agents-detail-title">
					<h1>{isNew ? (draft.name.trim() || "New template") : template?.name}{template && isPreviewTemplate(template) ? <span className="neo-preview" title="NeoPi can't list its own definitions yet; this one is preview data.">preview data</span> : null}</h1>
					{editable ? (
						<div className="neo-agents-detail-actions">
							{!isNew ? <NeoButton variant="ghost" size="sm" className="neo-danger-text" disabled={busy} onClick={() => void run(async () => { await agentCatalog.remove(template!.id); await onChanged(); onBack(); })}><Trash2 size={13} /> Delete</NeoButton> : null}
							<NeoButton variant="ghost" size="sm" disabled={busy || !dirty} onClick={() => { setDraft(initial); setToolsText((initial.tools ?? []).join(", ")); }}>Discard</NeoButton>
							<NeoButton variant="primary" size="sm" disabled={busy || (!dirty && !isNew)} onClick={save}><Save size={13} /> {isNew ? "Create" : dirty ? "Save" : "Saved"}</NeoButton>
						</div>
					) : null}
				</div>
				<p className="neo-agents-detail-sub">{template ? provenance(template) : "Written in the deck"}{template?.source.path ? <> · <span className="neo-mono">{template.source.path}</span></> : null}{template?.preset ? <> · {template.preset}</> : null}</p>
			</div>
			{error ? <ErrorState error={error} /> : null}

			<AgentSection title="Definition" how={editable ? "What every instance of this template starts with. Changing it affects the next instance, not the ones already running." : "What every instance of this template starts with. It lives in NeoPi's files; edit it there, the deck doesn't write them."}>
				<div className="neo-agents-form">
					<label className="neo-field"><span className="neo-field-label">Name</span><input className="neo-input" value={draft.name} onChange={(e) => set("name", e.target.value)} readOnly={!editable} placeholder="reviewer" /></label>
					<label className="neo-field"><span className="neo-field-label">Description</span><input className="neo-input" value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} readOnly={!editable} placeholder="What it does, in one sentence" /></label>
					<div className="neo-field"><span className="neo-field-label">Model <small>a selector or @role; an agent template is not a model role</small></span>{editable ? <ModelPicker value={draft.model ?? "@default"} onChange={(m) => set("model", m)} /> : <span className="neo-mono neo-agents-readonly">{draft.model ?? "Inherits the session's"}</span>}</div>
					<div className="neo-field"><span className="neo-field-label">Effort</span>{editable ? <Segmented label="Effort" options={EFFORTS.map((v) => ({ value: v, label: v }))} value={effort} onChange={(v) => set("thinking", v === "inherit" ? undefined : v)} /> : <span className="neo-agents-readonly">{draft.thinking ?? "inherit"}</span>}</div>
					<label className="neo-field neo-agents-wide"><span className="neo-field-label">Tools <small>comma separated; empty means the session's default set</small></span><input className="neo-input neo-mono" value={toolsText} onChange={(e) => setToolsText(e.target.value)} readOnly={!editable} placeholder="read, grep, find" /></label>
					<label className="neo-field neo-agents-wide"><span className="neo-field-label">System prompt</span><textarea className="neo-input neo-mono neo-agents-prompt" rows={8} value={draft.systemPrompt ?? ""} onChange={(e) => set("systemPrompt", e.target.value)} readOnly={!editable} placeholder={editable ? "Who this agent is and how it works." : "Not reported"} /></label>
				</div>
			</AgentSection>

			{template ? (
				<AgentSection title="Start an instance" how="An instance is a running agent with its own conversation, made from this template. Anything it starts reports to it; that is a relationship, not a different kind of agent.">
					<div className="neo-agents-spawn">
						<label className="neo-field"><span className="neo-field-label">Name</span><input className="neo-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={template.name} /></label>
						<label className="neo-field neo-agents-wide"><span className="neo-field-label">First task <small>optional</small></span><textarea className="neo-input" rows={2} value={task} onChange={(e) => setTask(e.target.value)} placeholder="What it should do first" /></label>
						<div className="neo-agents-spawn-bar">
							<span className="neo-dim">{agentCatalog.spawnPreview ? "Preview: NeoPi can't start an agent from a template over RPC yet (neopi#11). The instance appears below, marked preview." : null}</span>
							<NeoButton variant="primary" size="sm" disabled={busy} onClick={spawn}>Start instance</NeoButton>
						</div>
					</div>
				</AgentSection>
			) : null}

			{template ? (
				<AgentSection title={`Instances · ${mine.length}`} how="Every agent started from this template, running or finished. Select one to inspect it.">
					<InstanceTable rows={mine} all={instances} templates={templates} selected={selected} onSelect={onSelect} hideTemplate empty={<span className="neo-dim">No instance of {template.name} yet. Start one above.</span>} />
				</AgentSection>
			) : null}
		</div>
	);
}

function splitTools(text: string): string[] {
	return text.split(",").map((t) => t.trim()).filter(Boolean);
}
