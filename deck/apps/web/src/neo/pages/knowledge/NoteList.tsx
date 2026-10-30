import { ChevronDown, ChevronRight, FileSearch } from "lucide-react";
import { useEffect, useState } from "react";
import type { KbSearchResponse, KbTreeEntry, KbTreeResponse } from "@npi-deck/protocol";
import { Empty, ErrorState, formatShortRelative, TableSkeleton } from "@/components/neo";
import { knowledge } from "../../client/knowledge";
import { dirColor } from "../../components/KnowledgeMap";

export function noteTitle(path: string): string { return (path.split("/").pop() ?? path).replace(/\.md$/i, ""); }
export function noteDir(path: string): string { return path.includes("/") ? path.split("/")[0]! : ""; }

function NoteRow({ entry, active, title, onOpen }: { entry: KbTreeEntry; active?: string; title?: string; onOpen: (path: string) => void }) {
	return <button type="button" className="neo-row" data-active={active === entry.path} aria-current={active === entry.path ? "page" : undefined} onClick={() => onOpen(entry.path)} title={entry.path}>
		<span className="neo-row-lead"><i className="neo-knowledge-dot" style={{ background: dirColor(noteDir(entry.path)) }} /></span>
		<span className="neo-row-title">{title ?? noteTitle(entry.path)}</span>
		<span className="neo-row-when">{entry.mtime ? formatShortRelative(entry.mtime) : ""}</span>
		<span className="neo-row-sub neo-mono">{entry.path}</span>
	</button>;
}

export function NoteList({ tree, counter, mode, active, titles, results, searching, searchError, searchActive, onOpen }: {
	tree: KbTreeResponse; counter: number; mode: "tree" | "recent"; active?: string; titles: Record<string, string>;
	results: KbSearchResponse | null; searching: boolean; searchError: string | null; searchActive: boolean; onOpen: (path: string) => void;
}) {
	const [recent, setRecent] = useState<KbTreeEntry[] | null>(null);
	const [recentError, setRecentError] = useState<string | null>(null);
	useEffect(() => {
		if (mode !== "recent") return;
		let cancelled = false;
		setRecent(null);
		async function flatten(branch: KbTreeResponse): Promise<KbTreeEntry[]> {
			const children = await Promise.all(branch.dirs.map(async (dir) => flatten(await knowledge.tree(dir.path))));
			return [...branch.files, ...children.flat()];
		}
		void flatten(tree).then((files) => { if (!cancelled) { setRecent(files.sort((a, b) => (b.mtime ?? "").localeCompare(a.mtime ?? "")).slice(0, 20)); setRecentError(null); } }).catch((error: unknown) => { if (!cancelled) setRecentError(String(error)); });
		return () => { cancelled = true; };
	}, [tree, counter, mode]);
	if (searchActive) return <>
		<div className="neo-split-group">{searching ? "Searching notes…" : `${results?.totalMatches ?? 0} matching notes`}</div>
		{searchError ? <ErrorState error={searchError} /> : searching ? <TableSkeleton rows={3} /> : !results?.results.length ? <Empty icon={FileSearch} title="No notes match" hint="Try another word, or clear the search to browse the tree." /> : results.results.map((result) => <button type="button" key={result.path} className="neo-row neo-knowledge-result" data-active={active === result.path} onClick={() => onOpen(result.path)}>
			<span className="neo-row-lead"><i className="neo-knowledge-dot" style={{ background: dirColor(result.dir) }} /></span>
			<span className="neo-row-title">{result.title}</span><span className="neo-row-sub neo-mono">{result.path}</span>
			{result.snippet ? <span className="neo-knowledge-snippet">{result.snippet}</span> : null}
		</button>)}
	</>;
	if (mode === "recent") return recentError ? <ErrorState error={recentError} /> : !recent ? <TableSkeleton rows={4} /> : <>{recent.map((entry) => <NoteRow key={entry.path} entry={entry} active={active} title={titles[entry.path]} onOpen={onOpen} />)}</>;
	return <Branch tree={tree} counter={counter} active={active} titles={titles} onOpen={onOpen} root />;
}

function Branch({ tree, counter, active, titles, onOpen, root }: { tree: KbTreeResponse; counter: number; active?: string; titles: Record<string, string>; onOpen: (path: string) => void; root?: boolean }) {
	return <>{tree.dirs.map((dir) => <Directory key={dir.path} entry={dir} counter={counter} active={active} titles={titles} onOpen={onOpen} />)}
		{root && tree.files.length ? <div className="neo-split-group">Top-level notes <span className="neo-num">{tree.files.length}</span></div> : null}
		{tree.files.map((entry) => <NoteRow key={entry.path} entry={entry} active={active} title={titles[entry.path]} onOpen={onOpen} />)}
		{root && !tree.dirs.length && !tree.files.length ? <Empty title="No notes yet" hint="Ask an agent to write the first note." /> : null}
	</>;
}
function Directory({ entry, counter, active, titles, onOpen }: { entry: KbTreeEntry; counter: number; active?: string; titles: Record<string, string>; onOpen: (path: string) => void }) {
	const containsActive = active?.startsWith(`${entry.path}/`) ?? false;
	const [expanded, setExpanded] = useState(containsActive);
	const [tree, setTree] = useState<KbTreeResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { if (containsActive) setExpanded(true); }, [containsActive]);
	useEffect(() => {
		if (!expanded) return;
		let cancelled = false;
		void knowledge.tree(entry.path).then((data) => { if (!cancelled) { setTree(data); setError(null); } }).catch((e: unknown) => { if (!cancelled) setError(String(e)); });
		return () => { cancelled = true; };
	}, [expanded, entry.path, counter]);
	return <div className="neo-knowledge-directory">
		<button type="button" className="neo-split-group neo-knowledge-group" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
			{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {entry.name} <span className="neo-num">{entry.mdCount ?? tree?.files.length ?? ""}</span>
		</button>
		{expanded ? error ? <ErrorState error={error} /> : tree ? <Branch tree={tree} counter={counter} active={active} titles={titles} onOpen={onOpen} /> : <TableSkeleton rows={2} /> : null}
	</div>;
}
