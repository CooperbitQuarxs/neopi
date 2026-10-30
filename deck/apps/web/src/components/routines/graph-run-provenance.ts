import type { GraphEdge, GraphIterationAddress, GraphNode, GraphNodeRun, GraphOutput, GraphRunRecord, GraphValue, RoutineGraph } from "@npi-deck/protocol";

export interface RunOccurrence {
	key: string;
	run: GraphNodeRun;
	graph?: RoutineGraph;
	siblings: GraphNodeRun[];
}

/** Tree paths describe occurrences, not values or node IDs that can repeat. */
export function occurrenceKey(parent: string, collection: string, index: number): string {
	return `${parent}/${collection}/${index}`;
}

export function iterationLabel(address: readonly GraphIterationAddress[] | undefined): string {
	return address?.length ? address.map(part => `${part.nodeId}[${part.index}]`).join(" / ") : "Root graph";
}

export function valueDescription(value: GraphValue): { type: string; text: string } {
	if (value === null) return { type: "null", text: "null" };
	if (Array.isArray(value)) return { type: "array", text: value.length ? `${value.length} items` : "[]" };
	if (typeof value === "object") {
		const count = Object.keys(value).length;
		return { type: "object", text: count ? `${count} properties` : "{}" };
	}
	return { type: typeof value, text: typeof value === "string" ? JSON.stringify(value) : String(value) };
}

export function snapshotNodeTitle(node: GraphNode | undefined, fallback: string): string {
	for (const key of ["name", "label", "title"]) {
		const value = node?.config[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return node?.type ?? fallback;
}

export function iterationBody(node: GraphNode | undefined): RoutineGraph | undefined {
	const body = node?.config.body;
	if (!body || typeof body !== "object" || Array.isArray(body) || body.version !== 2 || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) return undefined;
	return body as unknown as RoutineGraph;
}

export function runOccurrences(trace: GraphRunRecord): RunOccurrence[] {
	const occurrences: RunOccurrence[] = [];
	function visit(runs: GraphNodeRun[], graph: RoutineGraph | undefined, parent: string): void {
		runs.forEach((run, index) => {
			const key = occurrenceKey(parent, "nodes", index);
			occurrences.push({ key, run, graph, siblings: runs });
			const body = iterationBody(graph?.nodes.find(node => node.id === run.nodeId));
			run.passes?.forEach((pass, passIndex) => visit(pass.nodeRuns, body, occurrenceKey(key, "passes", passIndex)));
		});
	}
	visit(trace.nodeRuns, trace.graph, trace.id);
	return occurrences;
}

export function sameAddress(left: GraphIterationAddress[] | undefined, right: GraphIterationAddress[] | undefined): boolean {
	return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

export function producingOccurrence(occurrences: RunOccurrence[], output: GraphOutput): RunOccurrence | undefined {
	const candidates = occurrences.filter(item => item.run.nodeId === output.nodeId && sameAddress(item.run.iteration, output.iteration));
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** No edge IDs are stored on envelopes. Reconstruct only a complete ordered match. */
export function derivedInputEdges(occurrence: RunOccurrence): (GraphEdge | undefined)[] {
	const { graph, run, siblings } = occurrence;
	if (!graph) return run.inputs.map(() => undefined);
	const reconstructed: { edge: GraphEdge; output: GraphOutput }[] = [];
	for (const edge of graph.edges) {
		if (edge.to.nodeId !== run.nodeId) continue;
		const producers = siblings.filter(candidate => candidate.nodeId === edge.from.nodeId && sameAddress(candidate.iteration, run.iteration));
		if (producers.length !== 1) return run.inputs.map(() => undefined);
		for (const output of producers[0]!.outputs) {
			if (output.port === edge.from.port) reconstructed.push({ edge, output });
		}
	}
	if (reconstructed.length !== run.inputs.length || reconstructed.some((item, index) => item.edge.to.port !== run.inputPorts[index] || JSON.stringify(item.output) !== JSON.stringify(run.inputs[index]))) return run.inputs.map(() => undefined);
	return reconstructed.map(item => item.edge);
}

export function nodeOutcome(run: GraphNodeRun): string {
	switch (run.status) {
		case "success": return run.outputs.length ? `Succeeded, ${run.outputs.length} output${run.outputs.length === 1 ? "" : "s"}` : "Succeeded without emitting an output";
		case "skipped": return "Skipped, not invoked. No output was emitted";
		case "failed": return "Failed";
		case "aborted": return "Aborted";
	}
}
