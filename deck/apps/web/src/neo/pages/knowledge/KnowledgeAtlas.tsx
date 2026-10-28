import { useMemo, useState } from "react";
import type { KbGraphResponse } from "@npi-deck/protocol";
import { Empty, NeoButton, NeoLinkButton, SearchInput } from "@/components/neo";
import { KnowledgeMap, mapLegend } from "../../components/KnowledgeMap";

export function KnowledgeAtlas({ graph, focus, onOpen }: { graph: KbGraphResponse | null; focus?: string; onOpen: (path: string) => void }) {
	const [query, setQuery] = useState("");
	const [directory, setDirectory] = useState<string | null>(null);
	const [hideOrphans, setHideOrphans] = useState(false);
	const [fit, setFit] = useState(0);
	const legend = useMemo(() => graph ? mapLegend(graph) : [], [graph]);
	const matches = useMemo(() => (graph?.nodes ?? []).filter(node => (!directory || (node.dir || "(root)") === directory) && (!hideOrphans || node.inbound + node.outbound > 0) && `${node.title} ${node.path} ${node.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [graph, directory, hideOrphans, query]);
	return <section className="neo-knowledge-atlas" aria-label="Knowledge map">
		<div className="neo-knowledge-atlas-toolbar">
			<SearchInput pageSearch value={query} onChange={setQuery} placeholder="Find a note on the map" aria-label="Find a note on the map" />
			<label><input type="checkbox" checked={hideOrphans} onChange={event => setHideOrphans(event.target.checked)} /> Connected notes only</label>
			<NeoButton size="sm" onClick={() => setFit(value => value + 1)}>Fit map</NeoButton>
			<NeoLinkButton size="sm" variant="ghost" to={`/studio?graph=map${focus ? `&note=${encodeURIComponent(focus)}` : ""}`}>Open in Studio</NeoLinkButton>
			<span>{matches.length} of {graph?.nodes.length ?? 0} notes</span>
		</div>
		<div className="neo-knowledge-atlas-body">
			<aside className="neo-knowledge-atlas-index" aria-label="Map index">
				<h2>Collections</h2>
				<button type="button" className="neo-knowledge-collection" aria-pressed={directory === null} onClick={() => setDirectory(null)}>All notes <span>{graph?.nodes.length ?? 0}</span></button>
				{legend.map(item => <button type="button" key={item.name} className="neo-knowledge-collection" aria-pressed={directory === item.name} onClick={() => setDirectory(item.name)}><i style={{ background: item.color }} />{item.name}<span>{item.count}</span></button>)}
				<h2>{query ? "Search results" : "Notes on this map"}</h2>
				<div className="neo-knowledge-atlas-results">{matches.map(node => <button type="button" className="neo-knowledge-link-row" key={node.path} onClick={() => onOpen(node.path)}><span>{node.title}</span><small>{node.path}</small></button>)}</div>
			</aside>
			<div className="neo-knowledge-atlas-stage">
				{graph && matches.length ? <KnowledgeMap key={fit} graph={graph} focus={focus} query={query} onlyDir={directory} hideOrphans={hideOrphans} onOpen={onOpen} /> : <Empty title={graph ? "No notes match these filters" : "Loading the map…"} hint={graph ? "Change the search or choose another collection." : undefined} />}
				<footer>Scroll to zoom. Drag to pan. Open any note to read its connections.{graph?.truncated ? ` Showing ${graph.nodes.length} of ${graph.totalNodes} notes.` : ""}</footer>
			</div>
		</div>
	</section>;
}
