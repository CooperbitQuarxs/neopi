import "./board.css";
import { ArrowDownLeft, GitBranch, Inbox, KanbanSquare, MessagesSquare, Plus, Settings2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Dot, Empty, ErrorState, formatShortRelative, NeoButton, NeoLinkButton, NeoSelect, PageHeader, SearchInput, Skeleton, Toolbar } from "@/components/neo";
import { projectLabel } from "@/lib/kanban-project";
import { useStore } from "@/lib/store";
import { board, type BoardCard, type BoardColumn } from "../client/board";
import { AgentSwatch } from "../components/AgentSwatch";
import { CardInspector } from "./board/CardInspector";
import { ColumnsDrawer, NewCardDrawer } from "./board/Editors";

export const activeRun = (card: BoardCard) => card.run?.status === "running" || card.run?.status === "queued";
const needsAttention = (card: BoardCard, columns: BoardColumn[]) => !card.archived && (card.run?.status === "failed" || card.holder?.kind === "person" || /blocked|needs.?input|needs.?you/i.test(columns.find(column => column.id === card.columnId)?.name ?? ""));

export function BoardPage() {
	const [cards, setCards] = useState<BoardCard[] | null>(null);
	const [columns, setColumns] = useState<BoardColumn[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [project, setProject] = useState("all");
	const [holder, setHolder] = useState("anyone");
	const [attention, setAttention] = useState(false);
	const [archived, setArchived] = useState(false);
	const [editor, setEditor] = useState<"columns" | "new" | null>(null);
	const [params, setParams] = useSearchParams();
	const selected = params.get("card") ?? params.get("open");
	const counter = useStore(s => s.tasksChangeCounter);
	const sequence = useRef(0);
	const refresh = useCallback(async () => {
		const seq = ++sequence.current;
		try {
			const [nextColumns, nextCards] = await Promise.all([board.columns(), board.cards({ archived: true })]);
			if (sequence.current !== seq) return;
			setColumns(nextColumns); setCards(nextCards); setError(null);
		} catch (err) { if (sequence.current === seq) setError(`Could not load the board. ${String(err)}`); }
	}, []);
	useEffect(() => { void refresh(); }, [refresh, counter]);
	const projects = useMemo(() => [...new Set((cards ?? []).flatMap(card => card.cwd ? [card.cwd] : []))].sort(), [cards]);
	const relations = useMemo(() => {
		const byRef = new Map<string, BoardCard>();
		const counts = new Map<string, number>();
		for (const card of cards ?? []) { byRef.set(card.id, card); byRef.set(`T-${card.number}`, card); }
		for (const card of cards ?? []) {
			const parent = card.parent ? byRef.get(card.parent) : undefined;
			if (parent) counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
		}
		return { byRef, counts };
	}, [cards]);
	const visible = useMemo(() => (cards ?? []).filter(card => {
		if (!archived && card.archived || attention && !needsAttention(card, columns)) return false;
		if (project === "unassigned" ? Boolean(card.cwd) : project !== "all" && card.cwd !== project.slice(4)) return false;
		if (holder === "agents" && card.holder?.kind !== "agent") return false;
		if (holder === "unassigned" && card.holder) return false;
		return `${card.title}\nT-${card.number}\n${card.body}\n${card.holder?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
	}), [cards, archived, attention, columns, project, holder, search]);
	const open = selected ? relations.byRef.get(selected) : undefined;
	const working = cards?.filter(card => !card.archived && activeRun(card)).length ?? 0;
	const waiting = cards?.filter(card => needsAttention(card, columns)).length ?? 0;
	function select(id: string | null) {
		setParams(prev => { const next = new URLSearchParams(prev); next.delete("open"); if (id) next.set("card", id); else next.delete("card"); return next; });
	}
	return <div className="neo-fill neo-board-page">
		<PageHeader title="Board" description="The agents' work, from first capture to the result. Open a card to follow its evidence." actions={<NeoLinkButton to="/inbox?capture=1" variant="primary"><Inbox size={14} />Capture in Inbox</NeoLinkButton>} />
		<div className="neo-board-overview"><div className="neo-board-lenses" aria-label="Board view"><button type="button" aria-pressed={!attention} onClick={() => setAttention(false)}>All work</button><button type="button" aria-pressed={attention} onClick={() => setAttention(true)}>Needs attention <span>{waiting}</span></button></div><p><Dot tone={working ? "live" : undefined} />{working ? `${working} ${working === 1 ? "agent is" : "agents are"} working` : "No active assignments"}<span>Cards arrive from Inbox, threads and routines.</span></p></div>
		<Toolbar className="neo-board-toolbar" end={<Check checked={archived} onChange={setArchived}>Archived</Check>}>
			<SearchInput pageSearch value={search} onChange={setSearch} placeholder="Find work or an agent…" aria-label="Search cards" width={260} />
			<NeoSelect aria-label="Project filter" value={project} onChange={e => setProject(e.target.value)}><option value="all">Every project</option><option value="unassigned">No project</option>{projects.map(cwd => <option key={cwd} value={`cwd:${cwd}`}>{projectLabel(cwd)}</option>)}</NeoSelect>
			<div className="neo-board-lenses" role="group" aria-label="Holder filter">{[["anyone", "Everyone"], ["agents", "Agents"], ["unassigned", "Unassigned"]].map(([value, label]) => <button key={value} type="button" aria-pressed={holder === value} onClick={() => setHolder(value!)}>{label}</button>)}</div>
		</Toolbar>
		{error && <ErrorState error={error} onRetry={() => void refresh()} />}
		{cards === null ? <div className="neo-board neo-fill-body">{[0, 1, 2, 3].map(i => <div className="neo-board-column" key={i}><Skeleton height={36} /><div className="neo-board-column-body"><Skeleton height={105} /><Skeleton height={88} /></div></div>)}</div> : columns.length === 0 ? <Empty icon={KanbanSquare} title="No board columns" hint="Set up the work's lifecycle once. Cards can then arrive from the inbox." action={<NeoButton onClick={() => setEditor("columns")}>Configure columns</NeoButton>} /> : <>
			{visible.length === 0 && <div className="neo-board-filter-note" role="status">{attention ? "Nothing needs attention in this view." : cards.length === 0 ? "The board is ready. Capture something in Inbox to give it a route into work." : "No cards match these filters."}</div>}
			<div className="neo-board neo-fill-body" aria-label="Agent work board">{columns.map(column => {
				const inColumn = visible.filter(card => card.columnId === column.id);
				return <section key={column.id} className="neo-board-column" aria-label={column.name}>
					<header className="neo-board-column-head"><span className="neo-board-state-dot" style={{ background: column.color }} /><h2>{column.name}</h2><span className="neo-num">{inColumn.length}</span>{inColumn.some(activeRun) && <Dot tone="live" />}</header>
					<div className="neo-board-column-body">{inColumn.map(card => <Card key={card.id} card={card} selected={open?.id === card.id} parent={card.parent ? relations.byRef.get(card.parent) : undefined} childrenCount={relations.counts.get(card.id) ?? 0} onOpen={() => select(card.id)} />)}{inColumn.length === 0 && <p className="neo-board-column-empty">No work here</p>}</div>
				</section>;
			})}</div>
		</>}
		<footer className="neo-board-controls"><span>State changes and run outcomes are kept with each card.</span><div><NeoButton size="sm" variant="ghost" onClick={() => setEditor("new")} disabled={!columns.length}><Plus size={12} />Add directly</NeoButton><NeoButton size="sm" variant="ghost" onClick={() => setEditor("columns")}><Settings2 size={12} />Columns</NeoButton></div></footer>
		{selected && cards !== null && !open && <ErrorState error="This card is no longer on the board." onRetry={() => select(null)} />}
		{open && <CardInspector key={open.id} card={open} cards={cards ?? []} columns={columns} onClose={() => select(null)} onOpenCard={select} onChanged={refresh} onRemoved={() => { select(null); void refresh(); }} />}
		{editor === "columns" && <ColumnsDrawer columns={columns} onClose={() => setEditor(null)} onChanged={refresh} />}
		{editor === "new" && <NewCardDrawer columns={columns} projects={projects} initialProject={project.startsWith("cwd:") ? project.slice(4) : ""} onClose={() => setEditor(null)} onCreated={async card => { await refresh(); setEditor(null); select(card.id); }} />}
	</div>;
}

function Card({ card, selected, parent, childrenCount, onOpen }: { card: BoardCard; selected: boolean; parent?: BoardCard; childrenCount: number; onOpen: () => void }) {
	const Icon = { inbox: Inbox, github: GitBranch, thread: MessagesSquare, routine: Workflow, manual: Plus }[card.origin.kind];
	return <button type="button" className="neo-board-card" onClick={onOpen} data-board-card={card.id} aria-pressed={selected} data-running={activeRun(card)} data-failed={card.run?.status === "failed"} data-archived={card.archived}>
		<span className="neo-board-card-meta"><span>T-{card.number}</span><span title={card.cwd}>{projectLabel(card.cwd)}</span>{card.archived && <span>Archived</span>}</span>
		<span className="neo-board-card-title">{card.title}</span>
		{(parent || childrenCount > 0) && <span className="neo-board-related"><ArrowDownLeft size={11} />{parent ? `From T-${parent.number}` : `${childrenCount} related ${childrenCount === 1 ? "card" : "cards"}`}</span>}
		{card.holder ? <span className="neo-board-card-owner">{card.holder.kind === "agent" ? <AgentSwatch hue={card.holder.hue} name={card.holder.name} /> : <span>@{card.holder.handle}</span>}<span>{activeRun(card) ? card.run?.status === "queued" ? "Queued" : "Working" : card.run?.status ?? "Holding"}</span></span> : <span className="neo-board-card-unassigned">Awaiting assignment</span>}
		{card.holder?.kind === "agent" && <span className="neo-board-card-model">{card.holder.model}</span>}
		{card.evidence && <span className="neo-board-card-result">{card.evidence.text}</span>}
		<span className="neo-board-card-evidence"><Icon size={12} /><span>{card.origin.kind === "manual" ? "Added directly" : `From ${card.origin.kind}`}</span><time dateTime={card.evidence?.at ?? card.updatedAt}>{formatShortRelative(card.evidence?.at ?? card.updatedAt)}</time></span>
	</button>;
}
