import { validateRoutineGraph, type GraphEdge, type GraphNodeType, type RoutineGraph, type ValidationError } from "@npi-deck/protocol";

export interface GraphConnection {
	source: string | null;
	target: string | null;
	sourceHandle?: string | null;
	targetHandle?: string | null;
}

/** Only the proposed connection and the dependency DAG gate wiring a draft. */
export function connectionErrors(graph: RoutineGraph, catalogue: readonly GraphNodeType[], edge: GraphEdge): ValidationError[] {
	const index = graph.edges.length;
	const validation = validateRoutineGraph({ ...graph, edges: [...graph.edges, edge] }, catalogue);
	const prefix = `/edges/${index}`;
	return (validation.errors ?? []).filter(error => error.path === prefix || error.path.startsWith(`${prefix}/`) || (error.path === "/edges" && error.keyword === "cycle") || error.path.startsWith("/nodeTypes/"));
}

export function connectGraph(graph: RoutineGraph, catalogue: readonly GraphNodeType[], connection: GraphConnection, edgeId: string): { graph: RoutineGraph; errors: ValidationError[] } {
	const edge: GraphEdge = {
		id: edgeId,
		from: { nodeId: connection.source ?? "", port: connection.sourceHandle ?? "" },
		to: { nodeId: connection.target ?? "", port: connection.targetHandle ?? "" },
	};
	const errors = connectionErrors(graph, catalogue, edge);
	return errors.length ? { graph, errors } : { graph: { ...graph, edges: [...graph.edges, edge] }, errors: [] };
}

/** Retain edge order and the empty array, including after deleting the final edge. */
export function removeGraphEdges(graph: RoutineGraph, ids: ReadonlySet<string>): RoutineGraph {
	const edges = graph.edges.filter(edge => !ids.has(edge.id));
	return edges.length === graph.edges.length ? graph : { ...graph, edges };
}
