import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Inbox as InboxIcon, Route, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { InboxHistoryEvent, InboxItem, InboxKind, InboxProposal, InboxRouting } from "@npi-deck/protocol";
import { Empty, ErrorState, formatRelativeTime, formatShortRelative, NeoButton, NeoSelect, SearchInput, Segmented } from "@/components/neo";
import { Markdown } from "@/lib/markdown";
import { inboxApi } from "@/lib/inbox-api";
import { useStore } from "@/lib/store";
import { CaptureComposer } from "./inbox/CaptureComposer";
import { InboxRoutingStrip } from "@/components/inbox/InboxRoutingStrip";
import "./inbox.css";

type Filter = "waiting" | "all" | "done";

export function InboxPage() {
	const [items, setItems] = useState<InboxItem[] | null>(null);
	const [routing, setRouting] = useState<InboxRouting | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [routingError, setRoutingError] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>("waiting");
	const [search, setSearch] = useState("");
	const [params, setParams] = useSearchParams();
	const openId = params.get("item");
	const tasksCounter = useStore(state => state.tasksChangeCounter);
	const request = useRef(0);
	const focusTarget = useRef<string | null>(null);
	const refresh = useCallback(async () => {
		const version = ++request.current;
		const [inbox, routes] = await Promise.allSettled([inboxApi.list({ includeProcessed: true }), inboxApi.routing()]);
		if (version !== request.current) return;
		if (inbox.status === "fulfilled") { setItems(inbox.value.items); setError(null); }
		else setError(String(inbox.reason));
		if (routes.status === "fulfilled") { setRouting(routes.value); setRoutingError(null); }
		else setRoutingError(String(routes.reason));
	}, []);
	useEffect(() => { void refresh(); }, [refresh, tasksCounter]);
	useEffect(() => {
		const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
		return () => { window.clearInterval(timer); request.current += 1; };
	}, [refresh]);
	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (items ?? []).filter(item => filter === "all" || (filter === "done" ? Boolean(item.processedAt) : !item.processedAt))
			.filter(item => !needle || `${item.title} ${item.body}`.toLowerCase().includes(needle))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}, [items, filter, search]);
	const open = items?.find(item => item.id === openId);
	const waiting = items?.filter(item => !item.processedAt).length ?? 0;
	useEffect(() => {
		const target = focusTarget.current;
		if (!target) return;
		const element = document.getElementById(target) ?? (target !== "inbox-item-title" ? document.querySelector<HTMLInputElement>('[aria-label="Search the inbox"]') : null);
		if (element) { element.focus(); focusTarget.current = null; }
	}, [openId, open?.id]);

	function select(id: string | null, moveFocus = true): void {
		focusTarget.current = moveFocus ? id ? "inbox-item-title" : openId : null;
		setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set("item", id); else next.delete("item"); return next; });
	}
	async function capture(title: string, body: string, kind: InboxKind): Promise<void> {
		const created = await inboxApi.create({ title, body, kind, source: "deck" });
		request.current += 1;
		setItems(previous => [created, ...(previous ?? [])]);
		setFilter("waiting"); setSearch(""); select(created.id, false);
	}

	return <div className="neo-inbox" data-item-open={Boolean(open)}>
		<header className="inbox-heading"><div><h1>Inbox</h1><p>{items ? `${waiting} waiting` : "Loading inbox…"}<span>Capture first. Decide where it goes when you're ready.</span></p></div><NeoButton variant="ghost" size="sm" aria-label="Refresh inbox" onClick={() => void refresh()}><RotateCw size={14} /></NeoButton></header>
		<RoutingPanel routing={routing} error={routingError} retry={refresh} />
		<div className="neo-inbox-body">
			<aside className="neo-inbox-list" aria-label="Inbox items">
				<div className="neo-inbox-list-head"><SearchInput pageSearch value={search} onChange={setSearch} placeholder="Search the inbox" size="sm" aria-label="Search the inbox" /><Segmented label="Show" value={filter} onChange={setFilter} options={[
					{ value: "waiting", label: <>Waiting <span className="neo-num">{waiting}</span></> },
					{ value: "all", label: "All" }, { value: "done", label: "Done" },
				]} /></div>
				{error ? <ErrorState error={error} onRetry={() => void refresh()} className="m-3" /> : null}
				{items === null && !error ? <p className="inbox-loading" role="status">Loading captures…</p> : visible.length === 0 ? <Empty icon={InboxIcon} title={search ? "Nothing matches" : filter === "waiting" ? "Nothing waiting" : "No captures here"} hint={search ? "Clear the search or switch the filter." : "Capture a thought below. It stays here until you decide what to do with it."} /> : <ul className="neo-inbox-rows">
					{visible.map(item => <li key={item.id}><button id={item.id} type="button" className="neo-inbox-row" data-active={item.id === openId} onClick={() => select(item.id)} aria-current={item.id === openId ? "true" : undefined}>
						<span className="inbox-row-title">{item.title}</span><time dateTime={item.createdAt}>{formatShortRelative(item.createdAt)}</time><span className="inbox-row-meta">{item.kind}{item.source ? ` · ${item.source}` : ""}{item.processedAt ? " · done" : ""}</span>
					</button></li>)}
				</ul>}
			</aside>
			<section className="neo-inbox-detail" aria-label="Open inbox item">
				{open ? <ItemView key={open.id} item={open} routing={routing} onBack={() => select(null)} onChanged={refresh} /> : <Empty icon={InboxIcon} title={openId ? "Item not found" : "A place for the next thought"} hint={openId ? "This capture may have been removed. Choose another item." : "Open a capture to read it, see its route, or file it to the board."} />}
			</section>
		</div>
		<CaptureComposer onCapture={capture} />
	</div>;
}

function RoutingPanel({ routing, error, retry }: { routing: InboxRouting | null; error: string | null; retry: () => Promise<void> }) {
	const [expanded, setExpanded] = useState(false);
	const flow = routing?.defaultFlow;
	const summary = flow ? `Tickets · ${flow.repository || "repository not configured"} · ${flow.enabled ? "enabled" : "paused"}` : "Checking active handlers…";
	return <section className="inbox-routing" aria-label="Inbox routing">
		<button type="button" className="inbox-routing-toggle" aria-expanded={expanded} aria-controls="inbox-routing-details" onClick={() => setExpanded(value => !value)}><Route size={15} /><span>Routing</span><span className="inbox-routing-summary">{error ? "Routing unavailable" : summary}</span><ChevronDown size={14} data-open={expanded} /></button>
		{expanded ? <div className="inbox-routing-details" id="inbox-routing-details">
			<InboxRoutingStrip onChanged={() => { void retry(); }} />
		</div> : null}
	</section>;
}

function ItemView({ item, routing, onBack, onChanged }: { item: InboxItem; routing: InboxRouting | null; onBack: () => void; onChanged: () => Promise<void> }) {
	const [proposal, setProposal] = useState<InboxProposal | null>(null);
	const [events, setEvents] = useState<InboxHistoryEvent[] | null>(null);
	const [column, setColumn] = useState("");
	const [project, setProject] = useState("");
	const [destinationKind, setDestinationKind] = useState<"card" | "issue">("card");
	const [repository, setRepository] = useState("");
	const [preview, setPreview] = useState<string | null>(null);
	const initialized = useRef(false);
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			void Promise.all([inboxApi.proposal(item.id), inboxApi.history(item.id)]).then(([next, history]) => {
				if (cancelled) return;
				setProposal(next); setEvents(history.events); setError(null);
				if (next.destination.kind === "card") {
					const defaultColumn = next.destination.column;
					setColumn(previous => previous || defaultColumn);
				}
				if (!initialized.current) {
					initialized.current = true;
					if (next.destination.kind === "issue") { setDestinationKind("issue"); setRepository(next.destination.repo); }
				}
			}).catch(cause => { if (!cancelled) setError(String(cause)); });
		};
		load();
		const timer = window.setInterval(() => { if (!document.hidden) load(); }, 15_000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [item.id, item.processedAt, revision]);
	const receipts = events?.filter(event => event.receipt) ?? [];
	const receipt = item.filing ?? receipts.at(-1)?.receipt;
	const selectedColumn = column || routing?.defaultColumn || "";
	const columnName = routing?.columns.find(state => state.id === selectedColumn)?.name ?? selectedColumn;
	async function previewIssue(): Promise<void> {
		if (busy) return;
		setBusy(true); setError(null); setPreview(null);
		try { const result = await inboxApi.previewIssue(item.id, repository); setPreview(`Would file "${result.plan.title}" in ${repository}. No issue was created.`); }
		catch (cause) { setError(String(cause)); }
		finally { setBusy(false); }
	}
	async function mutate(action: () => Promise<unknown>): Promise<void> {
		if (busy) return;
		setBusy(true); setError(null);
		try { await action(); setRevision(value => value + 1); await onChanged(); }
		catch (cause) { setError(String(cause)); }
		finally { setBusy(false); }
	}
	return <article className="inbox-item">
		<NeoButton variant="ghost" size="sm" className="inbox-mobile-back" onClick={onBack}><ArrowLeft size={14} />All captures</NeoButton>
		<header className="inbox-item-head"><div><h2 id="inbox-item-title" tabIndex={-1}>{item.title}</h2><p>{item.kind}{item.source ? ` · ${item.source}` : ""}<span title={new Date(item.createdAt).toLocaleString()}> · {formatRelativeTime(item.createdAt)}</span></p></div><NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => void mutate(() => inboxApi.update(item.id, { processed: !item.processedAt }))}><Check size={13} />{item.processedAt ? "Reopen" : "Done"}</NeoButton></header>
		{item.body.trim() ? <div className="inbox-item-body"><Markdown>{item.body}</Markdown></div> : null}
		{error ? <ErrorState error={error} onRetry={() => setRevision(value => value + 1)} /> : null}
		<section className="inbox-destination" aria-label="Filing destination">
			<h3>{receipt ? "Filed destination" : "Where it goes"}</h3>
			{receipt ? <Link className="inbox-filed-link" to={receipt.url}><Check size={15} />{receipt.label}<ArrowUpRight size={14} /></Link> : !proposal ? <p role="status">Loading destination…</p> : <>
				<p className="inbox-destination-name">{destinationKind === "issue" ? `GitHub › ${repository || "Choose a repository"}` : <>Board <span>›</span> {project || "Unassigned"} <span>›</span> {columnName}</>}</p>
				<p className="neo-dim">{proposal.reason}</p>
				{editing && routing ? <>
					<Segmented label="Destination" value={destinationKind} onChange={value => { if (!busy) { setDestinationKind(value); setPreview(null); } }} options={[{ value: "card", label: "Board card" }, { value: "issue", label: "GitHub issue" }]} />
					{destinationKind === "card" ? <div className="inbox-destination-editor">
						<label>Column<NeoSelect size="sm" value={selectedColumn} aria-label="Destination column" disabled={busy} onChange={event => setColumn(event.target.value)}>{routing.columns.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</NeoSelect></label>
						<label>Project working directory<input className="neo-input" aria-label="Project working directory" value={project} placeholder="Leave empty for unassigned" disabled={busy} onChange={event => setProject(event.target.value)} /></label>
					</div> : <label className="inbox-repository-field">GitHub repository<input className="neo-input" aria-label="GitHub repository" placeholder="owner/repository" value={repository} disabled={busy} onChange={event => { setRepository(event.target.value); setPreview(null); }} /><span>Filing uses this server's GitHub login. Preview makes no writes.</span></label>}
				</> : null}
				<div className="inbox-destination-actions">
					<NeoButton size="sm" variant="primary" disabled={busy || (destinationKind === "card" ? !selectedColumn : !repository.trim())} onClick={() => void mutate(() => inboxApi.file(item.id, destinationKind === "card" ? { kind: "card", project, column: selectedColumn } : { kind: "issue", repo: repository }))}><ArrowUpRight size={13} />{busy ? "Filing…" : destinationKind === "card" ? "File to board" : "File issue"}</NeoButton>
					{destinationKind === "issue" ? <NeoButton size="sm" disabled={busy || !repository.trim()} onClick={() => void previewIssue()}>Preview issue</NeoButton> : null}
					<NeoButton size="sm" variant="ghost" disabled={busy || !routing} onClick={() => setEditing(value => !value)}>{editing ? "Close options" : "Choose destination"}</NeoButton>
				</div>
				{preview ? <p className="neo-dim" role="status">{preview}</p> : null}
				{editing && routing ? <ul className="inbox-unavailable-destinations">{routing.destinations.filter(destination => !destination.available).map(destination => <li key={destination.kind}><span>{destination.kind === "issue" ? "GitHub issue" : destination.kind === "thread" ? "Agent thread" : "Knowledge note"}</span><p>{destination.reason}</p></li>)}</ul> : null}
			</>}
		</section>
		<section className="inbox-history" aria-label="Item history"><h3>What happened</h3>{events ? <ol>{events.map((event, index) => <li key={`${event.at}:${index}`}><span className="inbox-history-dot" /><div><p>{event.url ? <Link to={event.url}>{event.text}</Link> : event.text}</p><span>{event.actor} · <time dateTime={event.at} title={new Date(event.at).toLocaleString()}>{formatRelativeTime(event.at)}</time></span></div></li>)}</ol> : <p className="neo-dim" role="status">Loading history…</p>}</section>
	</article>;
}
