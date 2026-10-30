import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Dot, formatShortRelative, Table, type Column } from "@/components/neo";
import { hueFor, isPreviewInstance, statusTone, type AgentInstance, type AgentTemplate } from "../../client/agentDefinitions";
import { AgentSwatch } from "../../components/AgentSwatch";

/** A titled page section with one sentence on how to read it. */
export function AgentSection({ title, how, actions, children, legend }: { title: ReactNode; how: ReactNode; actions?: ReactNode; children: ReactNode; legend?: ReactNode }) {
	return (
		<section className="neo-agents-section">
			<header className="neo-agents-section-head">
				<div className="min-w-0">
					<h2>{title}</h2>
					<p>{how}</p>
				</div>
				{actions ? <div className="neo-agents-section-actions">{actions}</div> : null}
			</header>
			{children}
			{legend ? <footer className="neo-agents-legend">{legend}</footer> : null}
		</section>
	);
}

/** Status is a dot and a word. */
export function StatusWord({ status }: { status: AgentInstance["status"] }) {
	return (
		<span className="neo-agents-status" data-status={status}>
			<Dot tone={statusTone(status)} pulse={status === "running"} />
			{status}
		</span>
	);
}

export function threadHref(i: Pick<AgentInstance, "threadId" | "sessionId">): string | undefined {
	const id = i.threadId ?? (i.sessionId.startsWith("preview:") ? undefined : i.sessionId);
	return id ? `/threads?thread=${encodeURIComponent(id)}` : undefined;
}

/** Who started it: nobody but you (depth zero), or another instance. A relationship, not a kind. */
export function startedBy(i: AgentInstance, all: readonly AgentInstance[]): string {
	if (!i.parentInstanceId) return "you";
	return all.find((p) => p.id === i.parentInstanceId)?.label ?? "another agent";
}

export function InstanceTable({ rows, all, templates, selected, onSelect, empty, hideTemplate }: { rows: readonly AgentInstance[]; all: readonly AgentInstance[]; templates: readonly AgentTemplate[]; selected?: string | null; onSelect: (i: AgentInstance) => void; empty: ReactNode; hideTemplate?: boolean }) {
	const columns: Column<AgentInstance>[] = [
		{ key: "agent", header: "Agent", sort: (i) => i.label.toLowerCase(), render: (i) => <span className="neo-agents-identity"><AgentSwatch hue={hueFor(i.label)} name={i.label} />{isPreviewInstance(i) ? <span className="neo-preview">preview</span> : null}</span> },
		...(hideTemplate ? [] : [{ key: "template", header: "Template", sort: (i: AgentInstance) => i.templateName ?? "", render: (i: AgentInstance) => {
			const t = templates.find((x) => x.id === i.templateId);
			return t ? <Link className="neo-agents-link" to={`/agents?template=${encodeURIComponent(t.id)}`} onClick={(e) => e.stopPropagation()}>{t.name}</Link> : <span className="neo-dim">{i.templateName ?? "not reported"}</span>;
		} }]),
		{ key: "by", header: "Started by", sort: (i) => startedBy(i, all), render: (i) => <span className={i.parentInstanceId ? undefined : "neo-dim"}>{startedBy(i, all)}</span> },
		{ key: "thread", header: "Thread", render: (i) => { const href = threadHref(i); return href ? <Link className="neo-agents-link neo-mono" to={href} onClick={(e) => e.stopPropagation()}>{(i.threadId ?? i.sessionId).slice(0, 8)}</Link> : <span className="neo-dim">none</span>; } },
		{ key: "model", header: "Model", render: (i) => <span className="neo-mono neo-agents-model">{i.model ?? "Unknown"}</span> },
		{ key: "status", header: "Status", sort: (i) => ["running", "idle", "failed", "done", "cancelled"].indexOf(i.status), render: (i) => <StatusWord status={i.status} /> },
		{ key: "since", header: "Started", align: "right", sort: (i) => i.startedAt ?? "", render: (i) => <span className="neo-num neo-dim">{i.startedAt ? formatShortRelative(i.startedAt) : "Unknown"}</span> },
	];
	return <Table columns={columns} rows={rows} rowKey={(i) => i.id} onRowClick={onSelect} selectedKey={selected} initialSort={{ key: "status", dir: "asc" }} empty={empty} dense />;
}
