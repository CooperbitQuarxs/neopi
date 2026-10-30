import { useEffect, useState } from "react";
import type { GraphEffect, GraphNodeRun, GraphRunRecord, InboxKind, InboxRouting } from "@npi-deck/protocol";
import { Card, NeoBadge, NeoButton, NeoInput, NeoLinkButton, NeoTextarea, Segmented, Switch } from "@/components/neo";
import { GraphRunProvenance } from "@/components/routines/GraphRunProvenance";
import { inboxApi } from "@/lib/inbox-api";
import { KIND_ORDER, KIND_WORD } from "./ComposePane";

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function effectsOf(nodes: GraphNodeRun[]): GraphEffect[] {
	return nodes.flatMap(node => [...(node.effects ?? []), ...(node.passes ?? []).flatMap(pass => effectsOf(pass.nodeRuns))]);
}

/** Quick configuration edits the same protected native graph that Studio opens. */
export function InboxRoutingStrip({ onChanged }: { onChanged?: () => void } = {}) {
	const [routing, setRouting] = useState<InboxRouting>();
	const [loadError, setLoadError] = useState("");
	const [reload, setReload] = useState(0);
	const [panel, setPanel] = useState<"configure" | "preview" | null>(null);
	const [repository, setRepository] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState("");
	const [saved, setSaved] = useState(false);
	const [kind, setKind] = useState<InboxKind>("ticket");
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [previewing, setPreviewing] = useState(false);
	const [previewError, setPreviewError] = useState("");
	const [trace, setTrace] = useState<GraphRunRecord>();

	useEffect(() => {
		let alive = true;
		setLoadError("");
		void inboxApi.routing().then(result => {
			if (!alive) return;
			setRouting(result);
			setRepository(result.defaultFlow.repository);
			setEnabled(result.defaultFlow.enabled);
		}).catch(error => { if (alive) setLoadError(message(error)); });
		return () => { alive = false; };
	}, [reload]);

	async function save(): Promise<void> {
		setSaving(true);
		setSaveError("");
		setSaved(false);
		setTrace(undefined);
		try {
			const updated = await inboxApi.updateRouting({ repository: repository.trim(), enabled });
			setRouting(updated);
			setRepository(updated.defaultFlow.repository);
			setEnabled(updated.defaultFlow.enabled);
			setSaved(true);
			onChanged?.();
			try {
				setRouting(await inboxApi.routing());
				setLoadError("");
			} catch (error) {
				setLoadError(`Routing was saved, but the handler list could not refresh. ${message(error)}`);
			}
		} catch (error) {
			setSaveError(`Could not save routing. ${message(error)}`);
		} finally {
			setSaving(false);
		}
	}

	async function preview(): Promise<void> {
		setPreviewing(true);
		setPreviewError("");
		setTrace(undefined);
		try {
			setTrace(await inboxApi.previewRouting({ kind, title: title.trim(), body }));
		} catch (error) {
			setPreviewError(`Could not preview routing. ${message(error)}`);
		} finally {
			setPreviewing(false);
		}
	}

	const flow = routing?.defaultFlow;
	const otherFlows = routing?.flows.filter(handler => handler.id !== flow?.id) ?? [];
	const dirty = !!flow && (repository.trim() !== flow.repository || enabled !== flow.enabled);
	const status = !flow?.repository ? "Unconfigured" : flow.enabled ? "Enabled" : "Paused";

	return (
		<Card data-testid="inbox-routing" title="Automatic routing" description="The kind you choose when capturing a slip decides this route. No model classifies it."
			actions={flow ? <div className="flex flex-wrap gap-1.5">
				<NeoButton size="sm" on={panel === "configure"} aria-expanded={panel === "configure"} aria-controls="inbox-route-config" disabled={saving || previewing} onClick={() => setPanel(panel === "configure" ? null : "configure")}>Configure</NeoButton>
				<NeoButton size="sm" on={panel === "preview"} aria-expanded={panel === "preview"} aria-controls="inbox-route-preview" disabled={saving || previewing} onClick={() => setPanel(panel === "preview" ? null : "preview")}>Preview route</NeoButton>
				<NeoLinkButton to={flow.url} size="sm">Open in Studio</NeoLinkButton>
			</div> : undefined}>
			{loadError ? <div role="alert" className="mb-3 text-[12.5px] text-danger">{loadError} <NeoButton size="sm" onClick={() => setReload(value => value + 1)} disabled={saving || previewing}>Retry routing</NeoButton></div> : null}
			{flow ? <div className="space-y-3 text-[12.5px] leading-relaxed">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<strong className="text-ink">Ticket kind</strong><span aria-hidden="true" className="text-ink-3">→</span>
					<span className="min-w-0 break-all font-mono text-ink">{flow.repository || "No GitHub repository configured"}</span>
					<NeoBadge tone={!flow.repository ? "warn" : flow.enabled ? "ok" : undefined}>{status}</NeoBadge>
					{!flow.repository ? <span className="text-ink-3">{flow.enabled ? "Route enabled" : "Route paused"}</span> : null}
				</div>
				<p className="max-w-[78ch] text-ink-2">{!flow.repository ? "Set a repository to file new tickets. Until then, tickets remain in the inbox." : flow.enabled ? "New ticket-kind slips file GitHub issues. Other kinds do not file through this route." : "New tickets remain in the inbox while this route is paused."} Pausing stops only future items. It does not undo previous filings.</p>
				<p className="text-ink-3">Model classifier unavailable. Choose the kind explicitly. This default flow is protected from deletion.</p>
				<div className="border-t border-[var(--neo-line-1)] pt-3">
					<p className="text-ink-2">Other inbox graph handlers{otherFlows.length ? ". These run independently of the ticket route." : ": none configured."}</p>
					{otherFlows.length ? <ul className="mt-1.5 space-y-1.5">{otherFlows.map(handler => <li key={`${handler.id}/${handler.sourceNodeId}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
						<a href={handler.url} className="min-w-0 break-words text-accent hover:underline">{handler.name}</a><span className={handler.enabled ? "text-success" : "text-ink-3"}>{handler.enabled ? "Enabled" : "Disabled"}</span>
					</li>)}</ul> : null}
				</div>
				{panel === "configure" ? <form id="inbox-route-config" className="space-y-4 border-t border-[var(--neo-line-1)] pt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
					<label className="neo-field"><span className="neo-field-label">GitHub repository</span>
						<NeoInput value={repository} onChange={event => { setRepository(event.target.value); setSaved(false); }} disabled={saving} placeholder="github.com/owner/repository" autoComplete="off" spellCheck={false} aria-describedby="inbox-route-repo-help" />
						<span id="inbox-route-repo-help" className="neo-field-help">Use github.com/owner/repository. Leave empty to keep tickets in the inbox.</span>
					</label>
					<div className="flex items-center gap-2.5"><Switch label="Enable automatic ticket routing" checked={enabled} disabled={saving} onChange={value => { setEnabled(value); setSaved(false); }} /><span>{enabled ? "Route enabled for future tickets" : "Route paused for future tickets"}</span></div>
					{saveError ? <p role="alert" className="text-danger">{saveError}</p> : null}
					<div className="flex flex-wrap items-center gap-3"><NeoButton type="submit" variant="primary" size="sm" disabled={saving || !dirty}>{saving ? "Saving…" : "Save routing"}</NeoButton>{saved ? <span role="status" className="text-success">Routing saved.</span> : null}</div>
				</form> : null}
				{panel === "preview" ? <form id="inbox-route-preview" className="space-y-4 border-t border-[var(--neo-line-1)] pt-4" onSubmit={event => { event.preventDefault(); void preview(); }}>
					<p className="text-ink-2">Preview the saved graph with a sample slip. No inbox card, issue or other effect is written. {dirty ? "Save your configuration changes before previewing them." : ""}{!flow.enabled ? " The route is paused, so the preview will not dispatch its graph." : ""}</p>
					<div className="space-y-1.5"><span className="neo-field-label">Sample kind</span><div className="[&>.neo-segmented]:flex-wrap">
						<Segmented<InboxKind> label="Preview kind" value={kind} disabled={previewing} onChange={value => { setKind(value); setTrace(undefined); }} options={KIND_ORDER.map(value => ({ value, label: KIND_WORD[value] }))} />
					</div></div>
					<label className="neo-field"><span className="neo-field-label">Sample title</span><NeoInput required value={title} onChange={event => { setTitle(event.target.value); setTrace(undefined); }} disabled={previewing} placeholder="What should this ticket say?" /></label>
					<label className="neo-field"><span className="neo-field-label">Sample body</span><NeoTextarea rows={4} value={body} onChange={event => { setBody(event.target.value); setTrace(undefined); }} disabled={previewing} placeholder="Optional details" /></label>
					{previewError ? <p role="alert" className="text-danger">{previewError}</p> : null}
					<NeoButton type="submit" size="sm" variant="primary" disabled={previewing || !title.trim() || dirty}>{previewing ? "Previewing…" : "Preview without filing"}</NeoButton>
					{trace ? <RoutingPreview trace={trace} kind={kind} /> : null}
				</form> : null}
			</div> : !loadError ? <p role="status" className="text-[12.5px] text-ink-3">Loading routing…</p> : null}
		</Card>
	);
}

function RoutingPreview({ trace, kind }: { trace: GraphRunRecord; kind: InboxKind }) {
	const effects = effectsOf(trace.nodeRuns);
	const nonTicket = kind !== "ticket";
	return <div className="min-w-0 space-y-3 border-t border-[var(--neo-line-1)] pt-4" role="status" aria-label="Routing preview result">
		<p className="font-medium text-ink">Dry run {trace.status === "success" ? "complete" : trace.status}. Nothing was filed.</p>
		{trace.error ? <p role="alert" className="text-danger">{trace.error}</p> : null}
		{nonTicket ? <p className="text-ink-2">No filing for this kind. Only an original ticket-kind slip can pass the default route's gate.</p> : null}
		{!effects.length ? <p className="text-ink-2">No effects planned. The sample did not reach an action. Check the graph trace below for the branch taken.</p> : <ol className="space-y-4">{effects.map((effect, index) => {
			const destination = effect.destination;
			const repo = typeof destination.host === "string" && typeof destination.owner === "string" && typeof destination.repo === "string" ? `${destination.host}/${destination.owner}/${destination.repo}` : JSON.stringify(destination);
			return <li key={`${effect.logicalKey}/${index}`} className="space-y-2">
				<div className="flex flex-wrap items-baseline gap-2"><strong className="text-ink">Effect {index + 1}</strong><NeoBadge tone={effect.status === "planned" ? "accent" : "warn"}>{effect.status}</NeoBadge></div>
				<dl className="space-y-2">
					<div><dt className="text-ink-3">Destination</dt><dd className="break-all font-mono text-ink">{repo}</dd></div>
					{typeof effect.request.title === "string" ? <div><dt className="text-ink-3">Title</dt><dd className="break-words text-ink">{effect.request.title}</dd></div> : null}
					{typeof effect.request.body === "string" ? <div><dt className="text-ink-3">Body</dt><dd className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-ink-2">{effect.request.body || "No body"}</dd></div> : null}
				</dl>
			</li>;
		})}</ol>}
		<details className="min-w-0"><summary className="cursor-pointer text-accent">Graph plan and trace</summary><div className="mt-3 overflow-x-auto"><GraphRunProvenance trace={trace} /></div></details>
	</div>;
}
