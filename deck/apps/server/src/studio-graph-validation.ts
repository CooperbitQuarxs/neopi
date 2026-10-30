import { compatible, graphToToml, isGraphValue, nodePorts, nodeType, type StudioGraph } from "@npi-deck/protocol";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export function validateStudioGraph(value: unknown, id: string): asserts value is StudioGraph {
	if (!object(value) || value.id !== id || !text(value.name) || typeof value.description !== "string" || typeof value.enabled !== "boolean" || !["pipeline", "classifier", "boardflow"].includes(String(value.kind))) throw new Error("A graph needs its original id, a name, description, enabled flag and a pipeline, classifier or boardflow kind. Routers stay browser-local preview; flows use /api/routines.");
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !object(value.settings) || !isGraphValue(value.settings)) throw new Error("nodes and edges must be arrays, and settings must be a JSON object.");
	const ids = new Set<string>();
	for (const node of value.nodes) {
		if (!object(node) || !text(node.id) || ids.has(node.id) || !text(node.type) || nodeType(node.type)?.kind !== value.kind || !object(node.config) || !isGraphValue(node.config) || !object(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error("Every node needs a unique id, a known type for this graph kind, JSON config and finite canvas coordinates.");
		ids.add(node.id);
		for (const field of nodeType(node.type)!.fields) {
			const item = node.config[field.key];
			if (item === undefined) continue;
			if (field.control === "boolean" ? typeof item !== "boolean" : field.control === "number" || field.control === "percent" ? typeof item !== "number" || !Number.isFinite(item) : typeof item !== "string") throw new Error(`${node.id}: ${field.label} has the wrong value type.`);
			if (field.options && !field.options.includes(item as string)) throw new Error(`${node.id}: choose a listed ${field.label.toLowerCase()}.`);
		}
	}
	const graph = value as unknown as StudioGraph;
	const edgeIds = new Set<string>();
	const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
	const outgoing = new Map(graph.nodes.map(node => [node.id, [] as string[]]));
	for (const edge of graph.edges) {
		if (!object(edge) || !text(edge.id) || edgeIds.has(edge.id) || !object(edge.from) || !object(edge.to)) throw new Error("Every edge needs a unique id and named source and destination ports.");
		edgeIds.add(edge.id);
		const from = graph.nodes.find(node => node.id === edge.from.node), to = graph.nodes.find(node => node.id === edge.to.node);
		const output = from && nodePorts(from).outputs.find(port => port.id === edge.from.port), input = to && nodePorts(to).inputs.find(port => port.id === edge.to.port);
		if (!output || !input || !compatible(output, input)) throw new Error(`Connection ${edge.id} has missing or incompatible ports.`);
		incoming.set(to!.id, incoming.get(to!.id)! + 1); outgoing.get(from!.id)!.push(to!.id);
	}
	const queue = [...incoming].filter(([, count]) => !count).map(([id]) => id);
	let visited = 0;
	for (let i = 0; i < queue.length; i++) { visited++; for (const target of outgoing.get(queue[i]!)!) { const count = incoming.get(target)! - 1; incoming.set(target, count); if (!count) queue.push(target); } }
	if (visited !== graph.nodes.length) throw new Error("Connections must not form a cycle. Use an explicit list transform rather than a backward edge.");
	graphToToml(graph);
}
