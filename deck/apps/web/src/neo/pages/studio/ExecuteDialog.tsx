import { NeoButton, NeoDialog } from "@/components/neo";
import type { StudioGraph } from "../../client/studio";
import { nodeTitle } from "./StudioCanvas";
import { nodeType, studioNodeExecution } from "./vocab";

const GROUPS = [
 { support: "action", title: "Acts outside the canvas", read: "These steps create or change things: cards, issues, inbox items, notifications." },
 { support: "local", title: "Runs inside the deck", read: "Triggers, templates, JSON and logic. Nothing leaves the deck." },
 { support: "preview", title: "No executor yet", read: "Model, agent, approval and retry steps are plans for now. The deck refuses to execute a graph that contains them." },
] as const;

/**
 * Execute is the one Studio action with side effects, so it always asks. For a
 * graph it shows what each step will do and refuses when a step only exists as
 * a plan; for a flow it hands off to the routine runner.
 */
export function ExecuteDialog({ open, graph, flowName, flowExplanation, busy, onClose, onExecute }: { open: boolean; graph?: StudioGraph; flowName?: string; flowExplanation?: string; busy: boolean; onClose: () => void; onExecute: () => void }) {
 const steps = graph?.nodes.map(node => ({ node, support: studioNodeExecution(node.type) })) ?? [];
 const blocked = steps.filter(step => step.support === "preview");
 const name = graph?.name ?? flowName ?? "this graph";
 return <NeoDialog open={open} onClose={onClose} title={`Execute ${name}?`} description={graph ? "Execute runs the graph once for real, with its sample input. Preview run walks it without acting." : flowExplanation ?? "Execute runs the flow once now, with its real actions, the same as its trigger would."} width={540}
  footer={<><NeoButton variant="ghost" onClick={onClose}>Cancel</NeoButton><NeoButton variant="danger" onClick={onExecute} disabled={busy || blocked.length > 0}>{blocked.length ? "Cannot execute" : "Execute"}</NeoButton></>}>
  {graph ? <div className="neo-studio-execute">
   {GROUPS.map(group => { const items = steps.filter(step => step.support === group.support); return items.length ? <section key={group.support} data-support={group.support}>
    <h3>{group.title}</h3><p>{group.read}</p>
    <ul>{items.map(({ node }) => <li key={node.id}><strong>{nodeTitle(node)}</strong><small>{nodeType(node.type)?.label ?? node.type}</small></li>)}</ul>
   </section> : null; })}
  </div> : null}
 </NeoDialog>;
}
