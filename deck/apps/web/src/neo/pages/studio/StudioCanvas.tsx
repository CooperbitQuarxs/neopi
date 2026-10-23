import { BaseEdge, getBezierPath, Handle, MarkerType, Position, ReactFlowProvider, useNodesInitialized, useReactFlow, useUpdateNodeInternals, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type OnEdgesChange, type OnNodesChange } from "@xyflow/react";
import { Bot, Clock, Cpu, Database, GitFork, HelpCircle, KanbanSquare, OctagonX, Plus, Route, Search, Send, ShieldCheck, Shuffle, Workflow, Zap, TriangleAlert } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { GraphCanvasSurface } from "@/components/graph/GraphCanvasSurface";
import { Empty, SearchInput } from "@/components/neo";
import { graphProblems, type StudioGraph, type StudioNode } from "../../client/studio";
import { compatible, defaultConfig, NODE_TYPES, nodePorts, nodeType, type NodeType } from "./vocab";
const icons: Record<string, typeof Cpu> = { Bot, Clock, Cpu, Database, GitFork, HelpCircle, KanbanSquare, OctagonX, Route, Search, Send, ShieldCheck, Shuffle, Zap };
/** How one node fared in the run the person is looking at. */
export interface NodeRunState { status: "ok" | "failed" | "skipped" | "running"; note?: string }
interface CardData extends Record<string, unknown> { node: StudioNode; horizontal: boolean; problem?: string; run?: NodeRunState }
const RUN_WORDS: Record<NodeRunState["status"], string> = { ok: "Ran", failed: "Failed", skipped: "Skipped", running: "Running" };
type CanvasNode = Node<CardData, "studio">;
export function nodeTitle(node: StudioNode): string { return String(node.config.name || nodeType(node.type)?.label || node.type); }
function summary(node: StudioNode): { body: string; mono?: boolean; extra?: string } {
 const c = node.config;
 if (node.type === "router.stage") {
  const accounts = c.accounts === "all" ? `${c.accountCount ?? "All"} accounts` : Array.isArray(c.accounts) ? `${c.accounts.filter(Boolean).length} accounts` : String(c.accounts || "No accounts");
  return { body: String(c.model ?? "Choose a model").split("/").at(-1)!, mono: true, extra: `${accounts} · ${c.draw ?? "alternate"}\n${c.perAccount ?? 0}% each, cap ${c.cap ?? 0}%/${c.per ?? "user"}/${c.window ?? "week"}` };
 }
 if (c.question) return { body: String(c.question), extra: String(c.model ?? "") };
 if (c.model) return { body: String(c.model), mono: true, extra: node.type === "bf.assign" ? String(c.template ?? "Worker") : undefined };
 return { body: String(c.virtualModel || c.message || c.comment || c.condition || c.column || c.label || c.thread || c.repository || c.board || c.path || c.url || c.template || c.sample || c.cron || c.filter || c.who || (node.type === "transform.merge" ? "Wait for all three reviews" : node.type === "bf.done" ? "Move the card to done" : "Select to configure")), mono: Boolean(c.virtualModel || c.path) };
}
const NodeCard = memo(function NodeCard({ id, data, selected }: NodeProps<CanvasNode>) {
 const type = nodeType(data.node.type); const Icon = icons[type?.icon ?? ""] ?? Workflow;
 const ports = nodePorts(data.node); const s = summary(data.node); const update = useUpdateNodeInternals();
 const signature = ports.outputs.map(p => p.id).join(",");
 useEffect(() => { update(id); }, [id, signature, update]);
 return <div className="neo-node neo-studio-node" data-type={data.node.type} data-selected={selected || undefined} data-problem={Boolean(data.problem) || undefined} data-horizontal={data.horizontal} data-branches={ports.outputs.length} data-run={data.run?.status}>
 {ports.inputs.map((port, i) => <Handle key={port.id} type="target" position={data.horizontal ? Position.Left : Position.Top} id={port.id} aria-label={`${port.label} input, ${port.type}`} style={data.horizontal ? { top: `${(i + 1) / (ports.inputs.length + 1) * 100}%` } : { left: `${(i + 1) / (ports.inputs.length + 1) * 100}%` }} />)}
 <div className="neo-node-head"><span className="neo-node-icon" data-tone={type?.tone}><Icon size={14} /></span><div className="neo-node-titles"><div className="neo-node-title">{nodeTitle(data.node)}</div><div className="neo-node-kicker">{type?.label ?? data.node.type}</div></div></div>
 <div className="neo-node-body" data-mono={s.mono || undefined}>{s.body}{s.extra ? <span className="neo-studio-node-extra" data-mono={Boolean(data.node.config.question && data.node.config.model)}>{s.extra}</span> : null}</div>
 {data.problem ? <div className="neo-node-foot" data-tone="bad"><TriangleAlert size={12} />{data.problem}</div> : data.run ? <div className="neo-node-foot neo-studio-node-run" data-run={data.run.status} title={data.run.note}><i />{RUN_WORDS[data.run.status]}{data.run.note ? <span>{data.run.note}</span> : null}</div> : null}
 {ports.outputs.length > 1 ? <div className="neo-node-branches">{ports.outputs.map(port => <span key={port.id}>{port.label}</span>)}</div> : null}
 {ports.outputs.map((port, i) => <Handle key={port.id} type="source" position={data.horizontal ? Position.Right : Position.Bottom} id={port.id} aria-label={`${port.label} output, ${port.type}`} style={data.horizontal ? { top: `${(i + 1) / (ports.outputs.length + 1) * 100}%` } : { left: `${(i + .5) / ports.outputs.length * 100}%` }} />)}
 </div>;
});
const nodeTypes = { studio: NodeCard };
type RoutingEdge = Edge<{ caption?: string }, "routing">;
const RoutingEdgeView = memo(function RoutingEdgeView({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<RoutingEdge>) {
 const flow = useReactFlow();
 const [path, labelX] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
 const height = flow.getNode(source)?.measured?.height ?? 140;
 return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} label={data?.caption} labelX={labelX} labelY={sourceY - height / 2 - 14} labelStyle={{ fill: "rgb(var(--ink-2))", fontSize: 11.5 }} labelBgStyle={{ fill: "var(--neo-panel)" }} labelBgPadding={[5, 3]} labelBgBorderRadius={5} />;
});
const edgeTypes = { routing: RoutingEdgeView };
interface CanvasProps { graph: StudioGraph; selected: string | null; onSelect: (id: string | null) => void; onChange: (graph: StudioGraph) => void; run?: Record<string, NodeRunState> }
export function StudioCanvas(props: CanvasProps) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
/** Delete and Backspace remove the selected node or connection, unless focus is in a text field. */
const DELETE_KEYS = ["Delete", "Backspace"];
function Canvas({ graph, selected, onSelect, onChange, run }: CanvasProps) {
 const [palette, setPalette] = useState(false), [search, setSearch] = useState(""), [refusal, setRefusal] = useState(""), [edge, setEdge] = useState<string | null>(null);
 const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
 const flow = useReactFlow<CanvasNode>(); const horizontal = graph.kind === "router";
 const initialized = useNodesInitialized();
 const framed = useRef(false), addButton = useRef<HTMLButtonElement>(null), paletteRoot = useRef<HTMLElement>(null), root = useRef<HTMLDivElement>(null);
 useEffect(() => {
  if (!initialized || framed.current) return;
  const frame = requestAnimationFrame(() => {
   const measured = flow.getNodes();
   if (measured.length !== graph.nodes.length || measured.some(node => !node.measured?.width || !node.measured.height)) return;
   framed.current = true;
   void flow.fitView({ padding: .08, maxZoom: 1 });
  });
  return () => cancelAnimationFrame(frame);
 }, [initialized, graph.nodes.length, flow]);
 const problems = useMemo(() => graphProblems(graph), [graph]);
 const nodes = useMemo<CanvasNode[]>(() => graph.nodes.map(node => ({ id: node.id, type: "studio", position: node.position, measured: sizes[node.id], selected: selected === node.id, ariaLabel: `${nodeTitle(node)}, ${nodeType(node.type)?.label}. Enter selects the node, Delete removes it.`, data: { node, horizontal, problem: problems.find(p => p.nodeId === node.id)?.message, run: run?.[node.id] } })), [graph.nodes, selected, problems, horizontal, sizes, run]);
 const edges = useMemo<Edge[]>(() => graph.edges.map(item => {
  const source = graph.nodes.find(n => n.id === item.from.node);
  const branch = source && nodePorts(source).outputs.length > 1;
  return { id: item.id, source: item.from.node, target: item.to.node, sourceHandle: item.from.port, targetHandle: item.to.port, selected: item.id === edge, type: horizontal ? "routing" : "default", data: { caption: source?.type === "router.stage" ? "demote" : undefined }, label: branch ? item.from.port : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--ink-3))" }, style: { stroke: "rgb(var(--ink-4))", strokeWidth: 1.3 }, labelStyle: { fill: "rgb(var(--ink-2))", fontSize: 11.5 }, labelBgStyle: { fill: "var(--neo-panel)" }, labelBgPadding: [5, 3], labelBgBorderRadius: 5 };
 }), [graph.edges, graph.nodes, horizontal, edge]);
 useEffect(() => { if (selected) setEdge(null); }, [selected]);
 /* Selecting a node opens the inspector, which narrows the canvas after this render; the dock can also
    open later (an Execute refusal selects a node as its dialog closes). So check on selection and again
    whenever the canvas resizes, and bring the selected node back into view if it fell off the edge. */
 useEffect(() => {
  const element = root.current;
  if (!selected || !element) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
   const node = flow.getInternalNode(selected), box = element.getBoundingClientRect();
   if (!node || box.width === 0) return;
   const width = node.measured.width ?? 224, height = node.measured.height ?? 120, at = node.internals.positionAbsolute;
   const topLeft = flow.flowToScreenPosition(at), bottomRight = flow.flowToScreenPosition({ x: at.x + width, y: at.y + height });
   if (topLeft.x >= box.left && topLeft.y >= box.top && bottomRight.x <= box.right && bottomRight.y <= box.bottom) return;
   void flow.setCenter(at.x + width / 2, at.y + height / 2, { zoom: flow.getZoom(), duration: 220 });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(reveal, 80); };
  const observer = new ResizeObserver(schedule);
  observer.observe(element); schedule();
  return () => { clearTimeout(timer); observer.disconnect(); };
 }, [selected, flow]);
 useEffect(() => {
  if (!palette) return;
  const outside = (event: MouseEvent) => { const target = event.target as globalThis.Node | null; if (!paletteRoot.current?.contains(target) && !addButton.current?.contains(target)) closePalette(false); };
  document.addEventListener("mousedown", outside); return () => document.removeEventListener("mousedown", outside);
 }, [palette]);
 function closePalette(restore = true): void { setPalette(false); setSearch(""); if (restore) addButton.current?.focus(); }
 const changes: OnNodesChange<CanvasNode> = items => {
  let next = graph.nodes; let moved = false;
  let measurements: Record<string, { width: number; height: number }> | undefined;
  for (const change of items) {
   if (change.type === "select" && change.selected) onSelect(change.id);
   if (change.type === "dimensions" && change.dimensions) {
    measurements ??= { ...sizes };
    measurements[change.id] = change.dimensions;
   }
   if (change.type === "position" && change.position) { const position = change.position; next = next.map(n => n.id === change.id ? { ...n, position } : n); moved = true; }
  }
  if (measurements) setSizes(measurements);
  if (moved) onChange({ ...graph, nodes: next });
 };
 const edgeChanges: OnEdgesChange<Edge> = items => { for (const change of items) if (change.type === "select") { if (change.selected) { setEdge(change.id); onSelect(null); } else setEdge(current => current === change.id ? null : current); } };
 /* Removals arrive here once, with every node and edge React Flow deleted together. */
 function remove({ nodes: gone, edges: cut }: { nodes: CanvasNode[]; edges: Edge[] }): void {
  if (!gone.length && !cut.length) return;
  const nodeIds = new Set(gone.map(n => n.id)), edgeIds = new Set(cut.map(e => e.id));
  onChange({ ...graph, nodes: graph.nodes.filter(n => !nodeIds.has(n.id)), edges: graph.edges.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.from.node) && !nodeIds.has(e.to.node)) });
  if (selected && nodeIds.has(selected)) onSelect(null);
  setEdge(null);
 }
 function connect(connection: Connection): void {
  const source = graph.nodes.find(n => n.id === connection.source), target = graph.nodes.find(n => n.id === connection.target);
  if (!source || !target) return;
  const out = nodePorts(source).outputs.find(p => p.id === connection.sourceHandle), input = nodePorts(target).inputs.find(p => p.id === connection.targetHandle);
  if (!out || !input) return;
  if (!compatible(out, input)) { setRefusal(`Cannot connect ${out.type} to ${input.type}. Choose matching ports.`); return; }
  if (source.id === target.id) { setRefusal("A node cannot connect to itself. Choose another node."); return; }
  if (graph.edges.some(e => e.from.node === source.id && e.from.port === out.id && e.to.node === target.id && e.to.port === input.id)) return;
  setRefusal(""); onChange({ ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), from: { node: source.id, port: out.id }, to: { node: target.id, port: input.id } }] });
 }
 function add(type: NodeType): void {
  const bounds = document.querySelector(".neo-studio-canvas")?.getBoundingClientRect();
  let position = flow.screenToFlowPosition({ x: bounds ? bounds.left + bounds.width / 2 - 112 : 300, y: bounds ? bounds.top + bounds.height / 2 - 55 : 300 });
  while (graph.nodes.some(n => Math.abs(n.position.x - position.x) < 240 && Math.abs(n.position.y - position.y) < 150)) position = { x: position.x + 40, y: position.y + 160 };
  const node: StudioNode = { id: crypto.randomUUID(), type: type.type, config: defaultConfig(type), position };
  onChange({ ...graph, nodes: [...graph.nodes, node] }); onSelect(node.id); closePalette(false); void flow.setCenter(position.x + 112, position.y + 65, { zoom: Math.max(.8, flow.getZoom()), duration: 250 });
 }
 const available = NODE_TYPES.filter(n => n.kind === graph.kind && `${n.label} ${n.blurb} ${n.category}`.toLowerCase().includes(search.toLowerCase()));
 return <div ref={root} className="neo-studio-canvas">
 <GraphCanvasSurface<CanvasNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changes} onEdgesChange={edgeChanges} onDelete={remove} onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, item) => { setEdge(item.id); onSelect(null); }} onPaneClick={() => { onSelect(null); setEdge(null); if (palette) closePalette(false); }} onConnect={connect} fitViewOptions={{ padding: .08, maxZoom: 1 }} minZoom={.3} nodesFocusable edgesFocusable deleteKeyCode={DELETE_KEYS} />
 {graph.nodes.length === 0 ? <div className="neo-studio-canvas-empty"><Empty icon={Workflow} title="Start with a node" hint="Add a trigger or an input, then connect what should happen next." /></div> : null}
 <button ref={addButton} type="button" className="neo-studio-add" onClick={() => palette ? closePalette() : setPalette(true)} aria-expanded={palette} aria-haspopup="dialog"><Plus size={14} />Add node</button>
 {edge ? <div className="neo-studio-hint" role="status">Connection selected. Press Delete to remove it.</div> : null}
 {refusal || problems.length ? <button type="button" className="neo-canvas-pill neo-studio-problems" data-tone="bad" onClick={() => { if (refusal) setRefusal(""); else if (problems[0]?.nodeId) onSelect(problems[0].nodeId); }}><TriangleAlert size={12} />{refusal || (problems.length === 1 ? problems[0]!.message : `${problems.length} problems. Select to see the first.`)}</button> : null}
 {palette ? <section ref={paletteRoot} className="neo-studio-palette" role="dialog" aria-label="Add a node" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePalette(); } }}><SearchInput value={search} onChange={setSearch} placeholder={`Search ${available.length} node types`} aria-label="Search node types" autoFocus onKeyDown={event => { if (event.key === "Enter" && available[0]) { event.preventDefault(); add(available[0]); } }} />
 <div className="neo-studio-palette-rows">{[...new Set(available.map(n => n.category))].map(category => <section key={category}><h3>{category}</h3>{available.filter(n => n.category === category).map(type => { const Icon = icons[type.icon] ?? Workflow; return <button key={type.type} type="button" onClick={() => add(type)}><span className="neo-node-icon" data-tone={type.tone}><Icon size={14} /></span><span><strong>{type.label}</strong><small>{type.blurb}</small></span></button>; })}</section>)}{available.length === 0 ? <Empty title="No node types match" hint="Try a different word." /> : null}</div></section> : null}
 </div>;
}
