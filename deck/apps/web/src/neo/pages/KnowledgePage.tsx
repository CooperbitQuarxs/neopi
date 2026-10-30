import "./knowledge.css";
import { BookOpen, Network, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { KbBacklink, KbFileResponse, KbGraphResponse, KbSearchResponse, KbTreeResponse } from "@npi-deck/protocol";
import { Empty, ErrorState, Kbd, NeoButton, PageHeader, SearchInput, SectionLabel, Segmented, TableSkeleton } from "@/components/neo";
import type { KbStatusResponse } from "@/lib/kb-api";
import { useStore } from "@/lib/store";
import { knowledge, type KnowledgeHistoryEntry } from "../client/knowledge";
import { usePageShortcuts } from "../shortcuts";
import { PreviewChip } from "../components/PreviewChip";
import { dirColor, KnowledgeMap } from "../components/KnowledgeMap";
import { NAV_ITEMS } from "../nav";
import { NoteList } from "./knowledge/NoteList";
import { NoteMap } from "./knowledge/NoteMap";
import { fileTitle, NoteReader } from "./knowledge/NoteReader";
import { KnowledgeAtlas } from "./knowledge/KnowledgeAtlas";

const MAP_KEY = "neodeck.knowledge.map";
const nav = NAV_ITEMS.find((item) => item.to === "/knowledge")!;
function mapDefault(): boolean { try { return localStorage.getItem(MAP_KEY) === "true"; } catch { return false; } }

export function KnowledgePage() {
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const path = params.get("note") ?? undefined;
	const query = params.get("q") ?? "";
	const view = params.get("view") === "map" ? "map" : "notes";
	const changeView = useCallback((value: "map" | "notes") => {
		setParams(previous => { const next = new URLSearchParams(previous); if (value === "map") next.set("view", value); else next.delete("view"); return next; });
	}, [setParams]);
	const [mapOpen, setMapOpen] = useState(mapDefault);
	const [hops, setHops] = useState<"1" | "2" | "0">("2");
	const [mode, setMode] = useState<"tree" | "recent">("tree");
	const [tree, setTree] = useState<KbTreeResponse | null>(null);
	const [status, setStatus] = useState<KbStatusResponse | null>(null);
	const [graph, setGraph] = useState<KbGraphResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [file, setFile] = useState<KbFileResponse | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [backlinks, setBacklinks] = useState<KbBacklink[]>([]);
	const [relatedError, setRelatedError] = useState<string | null>(null);
	const [history, setHistory] = useState<KnowledgeHistoryEntry[]>([]);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [historyAvailable, setHistoryAvailable] = useState(false);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [results, setResults] = useState<KbSearchResponse | null>(null);
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [unresolved, setUnresolved] = useState<string | null>(null);
	const counter = useStore((store) => store.kbChangeCounter);
	const searchRef = useRef<HTMLInputElement>(null);
	const searchActive = query.trim().length >= 2;

	const open = useCallback((note: string, anchor = "") => {
		setUnresolved(null);
		const next = new URLSearchParams(params);
		next.set("note", note); next.delete("unresolved"); next.delete("view");
		navigate({ pathname: "/knowledge", search: `?${next}`, hash: anchor });
	}, [navigate, params]);
	const search = useCallback((value: string) => {
		setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set("q", value); else next.delete("q"); return next; }, { replace: true });
	}, [setParams]);
	function ask(note = path): void { navigate(`/threads?draft=${encodeURIComponent(note ? `Change the note knowledge/${note}: ` : "Add a note to the knowledge base about ")}`); }
	function askMissing(): void { navigate(`/threads?draft=${encodeURIComponent(`Write the note knowledge/${unresolved}: `)}`); }
	usePageShortcuts({ shortcuts: [{ key: "m", label: "Toggle Knowledge map", run: () => changeView(view === "map" ? "notes" : "map") }] });
	usePageShortcuts({ search: searchRef, focusSearch: () => {
		if (path) setParams(previous => { const next = new URLSearchParams(previous); next.delete("note"); return next; });
		requestAnimationFrame(() => searchRef.current?.focus());
	} }, view === "notes");

	useEffect(() => { try { localStorage.setItem(MAP_KEY, String(mapOpen)); } catch { /* The toggle still works when storage is disabled. */ } }, [mapOpen]);
	useEffect(() => {
		function key(event: KeyboardEvent): void {
			if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
			if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
			const target = event.target as HTMLElement | null;
			const typing = target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
			if (event.key === "Escape") {
				if (target === searchRef.current) { event.preventDefault(); search(""); }
				else if (!typing) setUnresolved(null);
				return;
			}
		}
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [search]);
	useEffect(() => {
		let cancelled = false;
		void Promise.all([knowledge.tree(), knowledge.status(), knowledge.graph()]).then(([nextTree, nextStatus, nextGraph]) => {
			if (cancelled) return;
			setTree(nextTree); setStatus(nextStatus); setGraph(nextGraph); setError(null);
		}).catch((cause: unknown) => { if (!cancelled) setError(`Could not load the knowledge base. Check the deck connection, then retry. ${String(cause)}`); });
		return () => { cancelled = true; };
	}, [counter, retry]);
	useEffect(() => {
		setFile(null); setFileError(null); setBacklinks([]); setHistory([]); setHistoryAvailable(false); setHistoryError(null); setRelatedError(null); setUnresolved(null);
		if (!path) return;
		let cancelled = false;
		void knowledge.file(path).then((next) => { if (!cancelled) { setFile(next); setTitles((previous) => ({ ...previous, [next.path]: fileTitle(next) })); } }).catch((cause: unknown) => { if (!cancelled) setFileError(`Could not open this note. Pick another note or retry. ${String(cause)}`); });
		void knowledge.backlinks(path).then((next) => { if (!cancelled) setBacklinks(next.backlinks); }).catch((cause: unknown) => { if (!cancelled) setRelatedError(String(cause)); });
		void knowledge.history(path).then((next) => { if (!cancelled) { setHistory(next.entries); setHistoryAvailable(next.available); } }).catch((cause: unknown) => { if (!cancelled) setHistoryError(String(cause)); });
		return () => { cancelled = true; };
	}, [path, counter, retry]);
	useEffect(() => {
		setResults(null); setSearchError(null); setSearching(searchActive);
		if (!searchActive) return;
		let cancelled = false;
		const timer = setTimeout(() => { void knowledge.search(query.trim()).then((next) => { if (!cancelled) setResults(next); }).catch((cause: unknown) => { if (!cancelled) setSearchError(`Search failed. Try again. ${String(cause)}`); }).finally(() => { if (!cancelled) setSearching(false); }); }, 160);
		return () => { cancelled = true; clearTimeout(timer); };
	}, [query, searchActive, counter]);
	const quickStart = useMemo(() => [...(graph?.nodes ?? [])].sort((a, b) => b.inbound - a.inbound || a.title.localeCompare(b.title)).slice(0, 6), [graph]);

	return <div className="neo-fill neo-knowledge">
		<PageHeader title={nav.label} description="Read what the office knows. Follow how it connects." badge={<PreviewChip domains={["knowledge"]} />} actions={<><Segmented label="Knowledge workspace" value={view} onChange={changeView} options={[{ value: "notes", label: "Notes" }, { value: "map", label: "Map" }]} /><NeoButton variant="primary" onClick={() => ask()}>Ask an agent to write</NeoButton></>} />
		{error ? <ErrorState error={error} onRetry={() => setRetry((value) => value + 1)} /> : null}
		{view === "map" ? <KnowledgeAtlas graph={graph} focus={path} onOpen={open} /> : <div className="neo-split neo-fill-body" data-note={Boolean(path)} data-side={Boolean(path) && mapOpen}>
			<aside className="neo-split-list" aria-label="Notes">
				<div className="neo-split-list-head"><SearchInput ref={searchRef} value={query} onChange={search} placeholder="Search notes" aria-label="Search notes" /><Segmented label="Browse notes" value={mode} onChange={setMode} options={[{ value: "tree", label: "Tree" }, { value: "recent", label: "Recent" }]} /></div>
				<div className="neo-split-rows">{tree ? <NoteList tree={tree} counter={counter} mode={mode} active={path} titles={titles} onOpen={open} results={results} searching={searching} searchError={searchError} searchActive={searchActive} /> : !error ? <TableSkeleton /> : null}</div>
				{status ? <footer className="neo-knowledge-list-footer">{status.fileCount} notes <span>Agent-maintained</span></footer> : null}
			</aside>
			<section className="neo-split-detail" aria-label="Note reader">
				{path ? <div className="neo-knowledge-reading-tools"><NeoButton size="sm" variant="ghost" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete("note"); return next; })}>All notes</NeoButton><span>Notes are authored by project agents.</span><NeoButton size="sm" variant="ghost" on={mapOpen} aria-pressed={mapOpen} onClick={() => setMapOpen(value => !value)}><Network size={14} /> Connections</NeoButton><NeoButton size="sm" variant="ghost" onClick={() => changeView("map")}>Full map <Kbd>M</Kbd></NeoButton></div> : null}
				{path ? fileError ? <ErrorState error={fileError} onRetry={() => setRetry((value) => value + 1)} /> : file ? <NoteReader key={file.path} file={file} onOpen={open} onAsk={() => ask()} onUnresolved={setUnresolved} /> : <TableSkeleton rows={8} /> : status ? <div className="neo-knowledge-welcome">
					<h2>The office's shared memory</h2>
					<p className="neo-knowledge-intro">Start with a note. Follow a connection. Leave what you learn for the next conversation.</p>
					<div className="neo-knowledge-welcome-map">{graph?.nodes.length ? <KnowledgeMap graph={graph} onOpen={open} /> : <Empty icon={BookOpen} title="No notes yet" hint="Ask a project agent to capture something the office should know." />}</div>
					<div className="neo-knowledge-welcome-actions"><NeoButton onClick={() => changeView("map")}><Network size={14} /> Explore the full map</NeoButton><span>{status.fileCount} notes</span></div>
					{quickStart.length ? <section className="neo-knowledge-quick-start"><SectionLabel>Connected starting points</SectionLabel>{quickStart.map(note => <button type="button" className="neo-knowledge-link-row" key={note.path} onClick={() => open(note.path)}><span><i className="neo-knowledge-dot" style={{ background: dirColor(note.dir) }} />{note.title}</span><small>{note.path}</small></button>)}</section> : null}
				</div> : !error ? <TableSkeleton /> : null}
				{unresolved ? <div className="neo-knowledge-unresolved" role="status"><div><strong>{unresolved}</strong><p>No note with this name yet.</p></div><NeoButton size="sm" onClick={askMissing}>Ask an agent to write it</NeoButton><NeoButton size="sm" variant="ghost" icon aria-label="Dismiss missing note" onClick={() => setUnresolved(null)}><X size={13} /></NeoButton></div> : null}
			</section>
			{path && mapOpen ? <NoteMap graph={graph} file={file} backlinks={backlinks} history={history} historyAvailable={historyAvailable} historyError={historyError} relatedError={relatedError} hops={hops} onHops={setHops} onOpen={open} onUnresolved={setUnresolved} onFullMap={() => changeView("map")} onClose={() => setMapOpen(false)} /> : null}
		</div>}
	</div>;
}
