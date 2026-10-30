import type { Edge, Node } from "@xyflow/react";
import type { GraphNode, GraphNodeRun, GraphNodeType, RoutineGraph, ValidationError } from "@npi-deck/protocol";

export interface RoutineNodeData extends Record<string, unknown> {
	node: GraphNode;
	definition?: GraphNodeType;
	inputPorts: GraphNodeType["inputs"];
	outputPorts: GraphNodeType["outputs"];
	errors: ValidationError[];
	run?: GraphNodeRun;
	historical: boolean;
	readOnly: boolean;
}
export type RoutineCanvasNode = Node<RoutineNodeData, "routine">;
export type RoutineCanvasEdge = Edge;

/** Positions are presentation only. Missing layout never invents execution edges. */
export function graphNodePosition(graph: RoutineGraph, id: string, index: number): { x: number; y: number } {
	return graph.layout?.nodes?.[id] ?? { x: (index % 3) * 300, y: Math.floor(index / 3) * 240 };
}

export function removeGraphNodes(graph: RoutineGraph, ids: ReadonlySet<string>): RoutineGraph {
	const nodes = graph.nodes.filter(node => !ids.has(node.id));
	if (nodes.length === graph.nodes.length) return graph;
	const positions = Object.fromEntries(Object.entries(graph.layout?.nodes ?? {}).filter(([id]) => !ids.has(id)));
	return {
		...graph,
		nodes,
		edges: graph.edges.filter(edge => !ids.has(edge.from.nodeId) && !ids.has(edge.to.nodeId)),
		...(graph.layout ? { layout: { ...graph.layout, nodes: positions } } : {}),
	};
}
