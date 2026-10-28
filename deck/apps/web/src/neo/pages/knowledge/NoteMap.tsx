import { X } from "lucide-react";
import type { KbBacklink, KbFileResponse, KbGraphResponse } from "@npi-deck/protocol";
import { Empty, NeoButton, SectionLabel, Segmented, formatShortRelative } from "@/components/neo";
import type { KnowledgeHistoryEntry } from "../../client/knowledge";
import { AgentSwatch } from "../../components/AgentSwatch";
import { KnowledgeMap } from "../../components/KnowledgeMap";
import { noteTitle } from "./NoteList";

export function NoteMap({ graph, file, backlinks, history, historyAvailable, historyError, relatedError, hops, onHops, onOpen, onUnresolved, onFullMap, onClose }: {
	graph: KbGraphResponse | null; file: KbFileResponse | null; backlinks: KbBacklink[]; history: KnowledgeHistoryEntry[]; historyAvailable: boolean; historyError: string | null; relatedError: string | null;
	hops: "1" | "2" | "0"; onHops: (hops: "1" | "2" | "0") => void; onOpen: (path: string) => void; onUnresolved: (target: string) => void; onFullMap: () => void; onClose: () => void;
}) {
	return <aside className="neo-split-side neo-knowledge-side" aria-label="Note map and connections">
		<header className="neo-knowledge-map-head"><h2>Connections</h2><NeoButton size="sm" variant="ghost" icon aria-label="Close connections" onClick={onClose}><X size={14} /></NeoButton></header>
		<div className="neo-knowledge-map-scope"><p>Follow the notes linked to this one.</p><Segmented label="Map scope" value={hops} onChange={onHops} options={[{ value: "1", label: "1 hop" }, { value: "2", label: "2 hops" }, { value: "0", label: "All" }]} /></div>
		<div className="neo-knowledge-map-canvas">{graph?.nodes.length ? <KnowledgeMap graph={graph} focus={file?.path} hops={Number(hops)} onOpen={onOpen} /> : <Empty title={graph ? "No notes to map yet" : "Loading the map…"} hint={graph ? "Ask an agent to add a note with links." : undefined} />}</div>
		<NeoButton variant="ghost" size="sm" onClick={onFullMap}>Open full map</NeoButton>
		<div className="neo-knowledge-map-caption">{graph ? <>{graph.nodes.length} notes <span>·</span> {graph.edges.length} connections{graph.unresolvedCount ? <p>{graph.unresolvedCount} {graph.unresolvedCount === 1 ? "link points" : "links point"} nowhere yet</p> : null}{graph.truncated ? <p>Map limited to {graph.nodes.length} of {graph.totalNodes} notes.</p> : null}</> : "Building connections…"}</div>
		<div className="neo-knowledge-connections">
			{relatedError ? <p className="neo-knowledge-quiet" role="alert">Could not load connections. {relatedError}</p> : null}
			<SectionLabel>Backlinks {backlinks.length}</SectionLabel>
			{!file ? <p className="neo-knowledge-quiet">Open a note to see what links to it.</p> : !backlinks.length ? <p className="neo-knowledge-quiet">No other note links here yet.</p> : backlinks.map((link, index) => <button key={`${link.source}:${index}`} type="button" className="neo-knowledge-link-row" onClick={() => onOpen(link.source)} title={link.snippet}>
				<span>{graph?.nodes.find((node) => node.path === link.source)?.title ?? noteTitle(link.source)}</span><small className="neo-mono">{link.source}</small>
			</button>)}
			<SectionLabel>Links out {file?.outgoingLinks.length ?? 0}</SectionLabel>
			{!file?.outgoingLinks.length ? <p className="neo-knowledge-quiet">{file ? "This note has no outgoing links." : "Open a note to follow its links."}</p> : file.outgoingLinks.map((link, index) => <button key={`${link.raw}:${index}`} type="button" className="neo-knowledge-link-row" data-unresolved={!link.resolved} title={link.resolved ?? "No note with this name yet"} onClick={() => link.resolved ? onOpen(link.resolved) : onUnresolved(link.target)}><span>{link.label}</span><small className="neo-mono">{link.resolved ?? "Not written yet"}</small></button>)}
			<SectionLabel>Git history</SectionLabel>
			{!file ? <p className="neo-knowledge-quiet">Open a note to see its history.</p> : historyError ? <p className="neo-knowledge-quiet" role="alert">Could not load history. {historyError}</p> : !historyAvailable ? <p className="neo-knowledge-quiet">This knowledge directory has no Git history. Agent activity history is not available.</p> : !history.length ? <p className="neo-knowledge-quiet">No commits for this note yet.</p> : history.map(event => <div key={event.id} className="neo-knowledge-history"><div><AgentSwatch hue={190} name={event.actor} /><time title={event.at}>{formatShortRelative(event.at)}</time></div><p>{event.text}</p><small>{event.id.slice(0, 8)}</small></div>)}
		</div>
	</aside>;
}
