import { useEffect, useState } from "react";
import type { GraphActivation, GraphNodeType, RoutineGraph } from "@npi-deck/protocol";
import { ErrorState, NeoButton, NeoDialog, NeoSelect } from "@/components/neo";
import { routinesApi } from "@/lib/routines-api";

/** A simulation chooses an actual registered source; it is never a manual-run admission. */
export function RoutinePreviewDialog({ open, graph, busy, onClose, onPreview }: {
 open: boolean; graph: RoutineGraph; busy: boolean; onClose: () => void;
 onPreview: (activation: GraphActivation) => Promise<void>;
}) {
 const [types, setTypes] = useState<GraphNodeType[]>([]), [source, setSource] = useState("");
 const [sample, setSample] = useState(""), [error, setError] = useState("");
 useEffect(() => {
  if (!open) return;
  let alive = true; setError("");
  setSample(JSON.stringify({ id: crypto.randomUUID(), title: "Sample capture", body: "A thought to route", items: ["truthy-not-true", true, 0] }, null, 2));
  void routinesApi.nodeTypes().then(({ nodeTypes }) => {
   if (!alive) return;
   setTypes(nodeTypes);
   const sources = graph.nodes.filter(node => nodeTypes.some(type => type.type === node.type && type.kind === "event"));
   setSource(sources[0]?.id ?? "");
  }).catch(reason => { if (alive) setError(String(reason)); });
  return () => { alive = false; };
 }, [open, graph]);
 const sources = graph.nodes.filter(node => types.some(type => type.type === node.type && type.kind === "event"));
 async function preview(): Promise<void> {
  setError("");
  try {
   const node = sources.find(item => item.id === source);
   if (!node || typeof node.config.eventType !== "string") throw new Error("Choose a source with an event type.");
   const event: unknown = JSON.parse(sample);
   if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("The sample event must be a JSON object.");
   await onPreview({ eventType: node.config.eventType, sourceNodeId: node.id, event: event as GraphActivation["event"] });
  } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
 }
 return <NeoDialog open={open} onClose={onClose} title="Preview this flow" description="Run a sample through a selected source. Actions only report their plans. No run history, cards, messages or issues are written." width={560}
  footer={<><NeoButton variant="ghost" onClick={onClose}>Cancel</NeoButton><NeoButton variant="primary" disabled={busy || !source} onClick={() => void preview()}>{busy ? "Previewing…" : "Preview run"}</NeoButton></>}>
  <div className="flex flex-col gap-4">
   {error ? <ErrorState error={error} /> : null}
   <label className="neo-field"><span>Start at</span><NeoSelect aria-label="Preview source" value={source} onChange={event => setSource(event.target.value)} disabled={busy}>
    {sources.map(node => <option key={node.id} value={node.id}>{types.find(type => type.type === node.type)?.label ?? node.type} · {node.id}</option>)}
   </NeoSelect><small className="neo-studio-help">This sample activates only this source. Execute always sends a manual event; new Inbox captures activate enabled inbox sources.</small></label>
   <label className="neo-field"><span>Sample event</span><textarea className="neo-input neo-mono" aria-label="Sample event JSON" rows={12} value={sample} onChange={event => setSample(event.target.value)} disabled={busy} spellCheck={false} /><small className="neo-studio-help">JSON values keep their types. The id identifies planned actions; it does not create an Inbox capture.</small></label>
  </div>
 </NeoDialog>;
}
