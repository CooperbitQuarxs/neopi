import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, useUpdateNodeInternals, type Connection, type EdgeChange, type NodeChange, type NodeProps } from "@xyflow/react";
import { Plus, Trash2, Workflow } from "lucide-react";
import type { GraphNodeType, GraphPort, GraphRunRecord, RoutineGraph, ValidationError } from "@npi-deck/protocol";
import { GraphCanvasSurface } from "@/components/graph/GraphCanvasSurface";
import { StudioPanel } from "@/neo/pages/studio/StudioPanel";
import { GraphRunProvenance } from "../GraphRunProvenance";
import { GraphConfigForm } from "./GraphConfigForm";
import { connectGraph, removeGraphEdges, type GraphConnection } from "./graph-connect";
import { newNodeConfig } from "./graph-config";
import { graphNodePosition, removeGraphNodes, type RoutineCanvasNode, type RoutineCanvasEdge } from "./graph-types";

export interface RoutineCanvasProps {
	graph: RoutineGraph;
	catalogue: readonly GraphNodeType[];
	onChange: (graph: RoutineGraph) => void;
	errors?: ValidationError[];
	trace?: GraphRunRecord | null;
	readOnly?: boolean;
	onConfigInvalidChange?: (invalid: boolean) => void;
	inspectorHidden?: boolean;
	onInspect?: () => void;
}
const DELETE_KEYS = ["Delete", "Backspace"];
const FIT_VIEW_OPTIONS = { padding: 0.15, minZoom: 0.3, maxZoom: 1.1 };
const PORT_COLOURS: Record<string, string> = { true: "rgb(var(--success))", false: "rgb(var(--danger))" };
const NO_ERRORS: ValidationError[] = [];

const RoutineNode = memo(function RoutineNode({ id, data, selected }: NodeProps<RoutineCanvasNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	useEffect(() => { updateNodeInternals(id); }, [id, data.inputPorts, data.outputPorts, updateNodeInternals]);
	const rows = Math.max(data.inputPorts.length, data.outputPorts.length, 1);
	return <div className={`relative w-[250px] rounded-[var(--r-card)] border bg-paper-2 shadow-sm ${selected ? "border-[var(--neo-accent-a)] ring-1 ring-[var(--neo-accent-a)]" : data.errors.length ? "border-danger" : "border-line"}`} style={{ minHeight: 76 + rows * 29 }}>
		<header className="border-b border-line px-3 py-2.5">
			<div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Workflow size={13} className="shrink-0 text-ink-3" /><span className="min-w-0 break-words">{data.definition?.label ?? data.node.type}</span></div>
			{data.definition ? <div className="mt-0.5 text-[11px] text-ink-3">{data.definition.kind === "event" ? "Event source" : data.definition.kind === "action" ? "Action" : data.definition.kind === "gate" ? "Gate" : "Operation"}</div> : <div className="text-[11px] text-warning">Registration unavailable</div>}
		</header>
		<div className="grid grid-cols-2 gap-x-4 px-3 py-2">
			<div>{data.inputPorts.map(port => <Port key={port.id} port={port} direction="target" typed={!!data.definition && !data.historical} readOnly={data.readOnly} />)}</div>
			<div>{data.outputPorts.map(port => <Port key={port.id} port={port} direction="source" typed={!!data.definition && !data.historical} readOnly={data.readOnly} />)}</div>
		</div>
		{data.run ? <div className={`border-t border-line px-3 py-1.5 text-[11px] ${data.run.status === "failed" || data.run.status === "aborted" ? "text-danger" : "text-ink-3"}`}>{data.run.status === "skipped" ? "Inactive branch" : data.run.status}{data.run.error ? `: ${data.run.error}` : ""}</div> : null}
		{data.errors[0] ? <div className="border-t border-danger/20 px-3 py-1.5 text-[11px] text-danger">{data.errors[0].message}</div> : null}
	</div>;
});
function Port({ port, direction, typed, readOnly }: { port: GraphPort; direction: "source" | "target"; typed: boolean; readOnly: boolean }) {
	return <div className={`relative flex h-[29px] items-center gap-1 text-[11px] ${direction === "source" ? "justify-end text-right" : ""}`}>
		<Handle id={port.id} type={direction} position={direction === "source" ? Position.Right : Position.Left} isConnectable={!readOnly} title={`${port.label ?? port.id}${typed ? `, ${port.type}${direction === "target" ? port.required === false ? ", optional" : ", required" : ""}${port.multiple ? ", multiple" : ""}` : ", stored port"}`} style={{ position: "absolute", top: "50%", [direction === "source" ? "right" : "left"]: -18, background: PORT_COLOURS[port.id] ?? "var(--neo-accent-a)", width: 10, height: 10 }} />
		<span className="min-w-0 break-words leading-tight" style={{ color: PORT_COLOURS[port.id] }}>{port.label ?? port.id}</span>
		{typed ? <span className="text-[9px] text-ink-3">{port.type}{port.multiple ? " ×" : ""}{direction === "target" && port.required === false ? "?" : ""}</span> : null}
	</div>;
}
const NODE_TYPES = { routine: RoutineNode };

export function RoutineCanvas(props: RoutineCanvasProps) {
	return <ReactFlowProvider><RoutineCanvasInner {...props} /></ReactFlowProvider>;
}
function RoutineCanvasInner({ graph, catalogue, onChange, errors = NO_ERRORS, trace, readOnly = false, onConfigInvalidChange, inspectorHidden, onInspect }: RoutineCanvasProps) {
	const flow = useReactFlow<RoutineCanvasNode, RoutineCanvasEdge>();
	const revealNode = useCallback((id: string) => {
		const node = flow.getNode(id);
		if (node) void flow.setCenter(node.position.x + (node.measured?.width ?? 250) / 2,
			node.position.y + (node.measured?.height ?? 140) / 2, { zoom: Math.max(0.8, flow.getZoom()) });
	}, [flow]);
	const canvasRoot = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = canvasRoot.current;
		if (!element) return;
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const selected = flow.getNodes().find(node => node.selected);
				if (selected) revealNode(selected.id); else void flow.fitView(FIT_VIEW_OPTIONS);
			});
		});
		observer.observe(element);
		return () => { observer.disconnect(); cancelAnimationFrame(frame); };
	}, [flow, revealNode]);
	useEffect(() => {
		const frame = requestAnimationFrame(() => { void flow.fitView(FIT_VIEW_OPTIONS); });
		return () => cancelAnimationFrame(frame);
	}, [graph.nodes.length, trace?.id, flow]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedId) return;
		const frame = requestAnimationFrame(() => revealNode(selectedId));
		return () => cancelAnimationFrame(frame);
	}, [selectedId, trace?.id, revealNode]);
	const [paletteOpen, setPaletteOpen] = useState(graph.nodes.length === 0);
	const [query, setQuery] = useState("");
	const [connectionIssue, setConnectionIssue] = useState<ValidationError[]>([]);
	const reportConfigInvalid = useCallback((invalid: boolean) => onConfigInvalidChange?.(invalid), [onConfigInvalidChange]);
	const selectedNode = graph.nodes.find(node => node.id === selectedId);
	const definitions = useMemo(() => new Map(catalogue.map(definition => [definition.type, definition])), [catalogue]);
	const imported = useMemo<RoutineCanvasNode[]>(() => graph.nodes.map((node, index) => {
		const definition = definitions.get(node.type);
		const storedPorts = (direction: "input" | "output"): GraphPort[] => [...new Set([
			...graph.edges.filter(edge => direction === "input" ? edge.to.nodeId === node.id : edge.from.nodeId === node.id).map(edge => direction === "input" ? edge.to.port : edge.from.port),
			...(trace?.nodeRuns.filter(run => run.nodeId === node.id).flatMap(run => direction === "input" ? run.inputPorts : run.outputs.map(output => output.port)) ?? []),
		])].map(id => ({ id, type: "object" }));
		return {
			id: node.id, type: "routine", position: graphNodePosition(graph, node.id, index), selected: selectedId === node.id,
			data: { node, definition, inputPorts: trace ? storedPorts("input") : definition?.inputs ?? storedPorts("input"), outputPorts: trace ? storedPorts("output") : definition?.outputs ?? storedPorts("output"), errors: errors.filter(error => error.path === `/nodes/${index}` || error.path.startsWith(`/nodes/${index}/`)), run: trace?.nodeRuns.find(run => run.nodeId === node.id), readOnly, historical: !!trace },
		};
	}), [graph, definitions, errors, selectedId, trace, readOnly]);
	const [nodes, setNodes, onFlowNodesChange] = useNodesState<RoutineCanvasNode>(imported);
	useEffect(() => { setNodes(imported); }, [imported, setNodes]);
	useEffect(() => { if (selectedId && !graph.nodes.some(node => node.id === selectedId)) setSelectedId(null); }, [graph.nodes, selectedId]);
	const edges = useMemo<RoutineCanvasEdge[]>(() => graph.edges.map(edge => ({ id: edge.id, source: edge.from.nodeId, sourceHandle: edge.from.port, target: edge.to.nodeId, targetHandle: edge.to.port, label: edge.from.port, style: { stroke: PORT_COLOURS[edge.from.port] ?? "rgb(var(--ink-3))" }, labelStyle: { fill: PORT_COLOURS[edge.from.port] ?? "rgb(var(--ink-2))", fontSize: 11 }, labelBgStyle: { fill: "var(--neo-panel)" } })), [graph.edges]);
	const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState<RoutineCanvasEdge>(edges);
	useEffect(() => { setFlowEdges(edges); }, [edges, setFlowEdges]);

	function handleNodesChange(changes: NodeChange<RoutineCanvasNode>[]) {
		onFlowNodesChange(changes);
		if (readOnly) return;
		const removed = new Set(changes.filter(change => change.type === "remove").map(change => change.id));
		let next = removeGraphNodes(graph, removed);
		for (const change of changes) if (change.type === "position" && change.position && change.dragging === false) next = { ...next, layout: { ...next.layout, nodes: { ...next.layout?.nodes, [change.id]: { ...next.layout?.nodes?.[change.id], x: change.position.x, y: change.position.y } } } };
		if (next !== graph) onChange(next);
	}
	function handleEdgesChange(changes: EdgeChange<RoutineCanvasEdge>[]) {
		onFlowEdgesChange(changes);
		if (readOnly) return;
		const removed = new Set(changes.filter(change => change.type === "remove").map(change => change.id));
		const next = removeGraphEdges(graph, removed); if (next !== graph) onChange(next);
	}
	function connect(connection: Connection) {
		if (readOnly) return;
		const result = connectGraph(graph, catalogue, connection, `edge-${crypto.randomUUID()}`);
		setConnectionIssue(result.errors); if (!result.errors.length) onChange(result.graph);
	}
	function candidateConnectionId(): string {
		let id = "pending-connection";
		while (graph.edges.some(edge => edge.id === id)) id += "-";
		return id;
	}
	function valid(connection: GraphConnection): boolean {
		return !readOnly && connectGraph(graph, catalogue, connection, candidateConnectionId()).errors.length === 0;
	}
	function add(definition: GraphNodeType) {
		const id = `${definition.type.replace(/[^a-zA-Z0-9_-]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
		onChange({ ...graph, nodes: [...graph.nodes, { id, type: definition.type, config: newNodeConfig(definition, catalogue) }], layout: { ...graph.layout, nodes: { ...graph.layout?.nodes, [id]: graphNodePosition(graph, id, graph.nodes.length) } } });
		setSelectedId(id); setPaletteOpen(false); onInspect?.();
	}
	const available = catalogue.filter(definition => definition.type !== "iteration.input" && `${definition.label} ${definition.kind} ${definition.type}`.toLowerCase().includes(query.toLowerCase()));
	return <div className="routine-canvas flex h-full min-h-[360px] flex-1 flex-col overflow-hidden">
		{!readOnly ? <div className="shrink-0 border-b border-line bg-paper-2 px-3 py-2">
			<div className="flex flex-wrap items-center gap-3"><button type="button" className="neo-btn" data-size="sm" data-variant="secondary" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(value => !value)}><Plus size={13} />Add node</button><p className="text-[12px] text-ink-3">Connect named outputs to inputs. Select a node to configure it.</p></div>
			{paletteOpen ? <section aria-label="Node library" className="mt-3 space-y-2"><input className="neo-input w-full" aria-label="Search registered nodes" placeholder="Find an event, gate, operation or action" value={query} onChange={event => setQuery(event.target.value)} /><div className="flex max-h-[220px] flex-wrap gap-2 overflow-y-auto">{available.map(definition => <button key={definition.type} type="button" className="neo-btn !h-auto !items-start !py-2 text-left" data-size="sm" data-variant="ghost" aria-label={`Add ${definition.label}`} onClick={() => add(definition)}><Plus size={12} className="mt-0.5 shrink-0" /><span>{definition.label}<span className="block text-[10px] font-normal text-ink-3">{definition.kind === "event" ? "Event source" : labelKind(definition.kind)}</span></span></button>)}{!available.length ? <p className="py-2 text-[12px] text-ink-3">No registered nodes match.</p> : null}</div></section> : null}
		</div> : <div className="shrink-0 border-b border-line bg-paper-2 px-3 py-2 text-[12px] text-ink-2">{trace ? "Historical graph. Wiring and configuration are read-only." : "The node library must load before editing."}</div>}
		{connectionIssue.length ? <ul role="alert" className="shrink-0 bg-[var(--neo-bad-soft)] px-3 py-2 text-[12px] text-danger">{connectionIssue.map((error, index) => <li key={index}><code>{error.path}</code> {error.message}</li>)}</ul> : null}
		<div ref={canvasRoot} className="relative min-h-0 flex-1">
			<GraphCanvasSurface<RoutineCanvasNode, RoutineCanvasEdge>
				nodes={nodes} edges={flowEdges} nodeTypes={NODE_TYPES}
				onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
				onConnect={connect} isValidConnection={valid}
				onConnectStart={() => setConnectionIssue([])}
				onConnectEnd={(_, state) => {
					if (readOnly || state.isValid || !state.fromHandle || !state.toHandle) return;
					const from = state.fromHandle.type === "source" ? state.fromHandle : state.toHandle;
					const to = state.fromHandle.type === "source" ? state.toHandle : state.fromHandle;
					const result = connectGraph(graph, catalogue, { source: from.nodeId, sourceHandle: from.id, target: to.nodeId, targetHandle: to.id }, candidateConnectionId());
					setConnectionIssue(result.errors);
				}}
				nodesDraggable={!readOnly} nodesConnectable={!readOnly}
				deleteKeyCode={readOnly ? null : DELETE_KEYS}
				onNodeClick={(_, node) => { setSelectedId(node.id); onInspect?.(); }}
				onPaneClick={() => setSelectedId(null)}
				fitView fitViewOptions={FIT_VIEW_OPTIONS}
			>
				{!nodes.length ? <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center"><div className="max-w-[300px] px-4 text-center"><h3 className="text-[15px] font-medium text-ink">Start with an event source</h3><p className="mt-1 text-[13px] text-ink-3">Add registered nodes, then wire the values each one receives.</p></div></div> : null}
			</GraphCanvasSurface>
		</div>
		{selectedNode && !inspectorHidden ? <StudioPanel title={definitions.get(selectedNode.type)?.label ?? selectedNode.type} subtitle={readOnly ? "Configuration executed in this run" : "Configure the selected node"} icon={<Workflow size={15} />} onClose={() => setSelectedId(null)} footer={!readOnly ? <button type="button" className="neo-btn text-danger" data-size="sm" data-variant="ghost" onClick={() => { onChange(removeGraphNodes(graph, new Set([selectedNode.id]))); setSelectedId(null); }}><Trash2 size={13} />Remove node</button> : undefined}>
			{readOnly ? <details><summary className="cursor-pointer text-[12px] text-ink-2">Executed configuration</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-2">{JSON.stringify(selectedNode.config, null, 2)}</pre></details> : <GraphConfigForm key={selectedNode.id} graph={graph} node={selectedNode} catalogue={catalogue} definition={definitions.get(selectedNode.type)} onChange={config => onChange({ ...graph, nodes: graph.nodes.map(node => node.id === selectedNode.id ? { ...node, config } : node) })} errors={errors.filter(error => error.path === `/nodes/${graph.nodes.indexOf(selectedNode)}` || error.path.startsWith(`/nodes/${graph.nodes.indexOf(selectedNode)}/`))} onIssuesChange={reportConfigInvalid} />}
			{!readOnly && selectedNode.type === "event.source" ? <p className="text-[12px] text-ink-3">Use manual as the event type for the Run button. Inbox sources receive new cards instead, and do not activate on a manual run.</p> : null}
			{trace ? <GraphRunProvenance trace={trace} nodeId={selectedNode.id} /> : null}
		</StudioPanel> : null}
	</div>;
}
function labelKind(kind: string): string { return kind[0]!.toUpperCase() + kind.slice(1); }
