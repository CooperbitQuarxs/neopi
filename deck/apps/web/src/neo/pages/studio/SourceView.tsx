import { useEffect, useState } from "react";
import { NeoBadge, NeoButton } from "@/components/neo";
import type { StudioGraph } from "../../client/studio";
import { graphFromToml, graphToToml } from "./toml";
export function SourceView({ graph, onChange, onPending }: { graph: StudioGraph; onChange: (graph: StudioGraph) => void; onPending: (pending: boolean) => void }) {
 const [source, setSource] = useState(() => graphToToml(graph));
 const [pending, setPending] = useState(false), [error, setError] = useState("");
 useEffect(() => { if (!pending) setSource(graphToToml(graph)); }, [graph, pending]);
 useEffect(() => () => onPending(false), [onPending]);
 function apply(): void { try { const next = graphFromToml(source, graph); onChange(next); setPending(false); onPending(false); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }
 return <div className="neo-source neo-studio-source"><div className="neo-source-bar"><span>Graph source</span><span className="neo-mono neo-studio-help">TOML</span><span className="neo-studio-spacer" />{pending ? <NeoBadge tone="warn">Not applied yet</NeoBadge> : <span className="neo-studio-help">Matches the canvas</span>}<NeoButton size="sm" onClick={apply} disabled={!pending}>Apply to canvas</NeoButton></div><textarea value={source} aria-label="Graph source" spellCheck={false} onChange={event => { setSource(event.target.value); setPending(true); onPending(true); }} />{error ? <div className="neo-source-problems" role="alert">{error} Fix the source and apply again.</div> : null}</div>;
}
