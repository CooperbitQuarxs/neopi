import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState, formatRelativeTime, KeyValue, NeoButton } from "@/components/neo";
import { agentCatalog, hueFor, isPreviewInstance, type AgentInstance, type AgentTemplate } from "../../client/agentDefinitions";
import { AgentSwatch } from "../../components/AgentSwatch";
import { StatusWord, startedBy, threadHref } from "./parts";

const ACTION_WORDS: Record<keyof AgentInstance["actions"], string> = { steer: "steer", cancel: "cancel", setThinking: "change effort", setFast: "toggle fast mode", enter: "enter its conversation" };

/**
 * The docked inspector for one instance: a sibling inset panel, open only
 * while something is selected. Actions are the ones NeoPi reports for this
 * instance; the rest are named, not hidden, so a missing ability reads as
 * missing rather than as a different kind of agent.
 */
export function InstanceInspector({ instance, all, templates, onClose, onChanged }: { instance: AgentInstance; all: readonly AgentInstance[]; templates: readonly AgentTemplate[]; onClose: () => void; onChanged: () => Promise<void> }) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { setText(""); setError(null); }, [instance.id]);
	useEffect(() => {
		function onKey(e: KeyboardEvent): void { if (e.key === "Escape" && !e.defaultPrevented) onClose(); }
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	async function run(action: () => Promise<void>): Promise<void> {
		setBusy(true); setError(null);
		try { await action(); await onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
	}
	const template = templates.find((t) => t.id === instance.templateId);
	const href = threadHref(instance);
	const ended = instance.status === "done" || instance.status === "cancelled" || instance.status === "failed";
	const missing = (Object.keys(ACTION_WORDS) as (keyof AgentInstance["actions"])[]).filter((k) => !instance.actions[k]).map((k) => ACTION_WORDS[k]);

	return (
		<aside className="neo-inspector" aria-label={`Instance ${instance.label}`}>
			<header className="neo-inspector-head">
				<div className="min-w-0">
					<h2><AgentSwatch hue={hueFor(instance.label)} name={instance.label} /></h2>
					<p>{template ? `instance of ${template.name}` : instance.templateName ? `instance of ${instance.templateName}` : "template not reported"} · started by {startedBy(instance, all)}</p>
				</div>
				<NeoButton variant="ghost" icon size="sm" aria-label="Close inspector" onClick={onClose}><X size={14} /></NeoButton>
			</header>
			<div className="neo-inspector-body">
				{error ? <ErrorState error={error} /> : null}
				<section>
					<h3>Lifecycle</h3>
					<div className="neo-agents-lifecycle"><StatusWord status={instance.status} />{instance.task ? <span className="neo-dim">{instance.task}</span> : null}</div>
				</section>
				<section>
					<h3>Identity</h3>
					<KeyValue items={[
						{ key: "Template", value: template ? <Link className="neo-agents-link" to={`/agents?template=${encodeURIComponent(template.id)}`}>{template.name}</Link> : (instance.templateName ?? "Not reported") },
						{ key: "Thread", value: href ? <Link className="neo-agents-link" to={href}>Open thread</Link> : "None" },
						{ key: "Session", value: <span className="neo-mono">{instance.sessionId}</span> },
						{ key: "Journal", value: instance.sessionFile ? <span className="neo-mono neo-agents-path" title={instance.sessionFile}>{instance.sessionFile}</span> : "Not reported" },
						{ key: "Instance id", value: <span className="neo-mono">{instance.id}</span> },
					]} />
				</section>
				<section>
					<h3>Model</h3>
					<KeyValue items={[
						{ key: "Model", value: <span className="neo-mono">{instance.model ?? "Unknown"}</span> },
						{ key: "Effort", value: instance.thinking ?? "Unknown" },
						{ key: "Started", value: instance.startedAt ? formatRelativeTime(instance.startedAt) : "Unknown" },
						...(instance.endedAt ? [{ key: "Ended", value: formatRelativeTime(instance.endedAt) }] : []),
					]} />
				</section>
				{instance.actions.steer && !ended ? (
					<section>
						<h3>Steer</h3>
						<p className="neo-inspector-how">Delivered as its next user message, between turns.</p>
						<textarea className="neo-input neo-agents-steer" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Tell ${instance.label}…`} aria-label={`Steer ${instance.label}`} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); void run(async () => { await agentCatalog.steer(instance.id, text.trim()); setText(""); }); } }} />
						<div className="neo-agents-steer-bar"><span className="neo-dim">ctrl+enter</span><NeoButton size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => void run(async () => { await agentCatalog.steer(instance.id, text.trim()); setText(""); })}>Send</NeoButton></div>
					</section>
				) : null}
				{missing.length && !isPreviewInstance(instance) ? <p className="neo-inspector-how">NeoPi doesn't let a client {missing.join(", ")} for this instance yet.</p> : null}
				{isPreviewInstance(instance) ? <p className="neo-inspector-how">Preview instance. Nothing is running: NeoPi can't start an agent from a template yet (neopi#11).</p> : null}
			</div>
			<footer className="neo-inspector-foot">
				{href ? <Link className="neo-btn" data-variant="ghost" data-size="sm" to={href}>Open thread</Link> : <span />}
				{instance.actions.cancel && !ended ? <NeoButton variant="danger" size="sm" disabled={busy} onClick={() => void run(() => agentCatalog.cancel(instance.id))}>Cancel instance</NeoButton> : null}
			</footer>
		</aside>
	);
}
