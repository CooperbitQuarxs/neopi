import { isGraphValue, nodePorts, nodeType, studioNodeExecution, type GraphEmission, type GraphExecutionResult, type GraphObject, type GraphProblem, type GraphValue, type RoutineGraph, type StudioGraph, type StudioNode, type StudioRun, type StudioRunOptions } from "@npi-deck/protocol";
import { getInbox, updateInbox } from "./db/inbox.ts";
import { getState, getTask, updateTask } from "./db/tasks.ts";
import { registerGraphActions } from "./routines/graph-actions.ts";
import { executeGraph, GraphNodeRegistry, GraphValidationError, type GraphNodeContext } from "./routines/graph-runner.ts";
import { evaluate } from "./routines/sandbox.ts";

function text(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value) ?? ""; }
function object(value: unknown): value is GraphObject { return !!value && typeof value === "object" && !Array.isArray(value) && isGraphValue(value); }
function path(value: GraphValue, key: unknown): GraphValue {
	if (!key) return value;
	for (const part of String(key).split(".")) {
		if (["__proto__", "prototype", "constructor"].includes(part) || !value || typeof value !== "object" || !Object.hasOwn(value, part)) throw new Error(`Input has no property ${String(key)}.`);
		value = (value as GraphObject)[part]!;
	}
	return value;
}
function interpolate(template: unknown, value: GraphValue): string { return String(template ?? "{{input}}").replace(/\{\{input(?:\.([\w.-]+))?\}\}/g, (_, key: string | undefined) => text(path(value, key))); }
function emit(port: string, value: unknown): GraphEmission[] {
	if (!isGraphValue(value)) throw new Error("A node returned a non-JSON result.");
	return [{ port, value: { value } }];
}
function required(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
const nativeStudioTypes = new Set(["gate.if", "gate.compare", "gate.member", "operation.number", "operation.arithmetic", "iteration.each"]);
function nativeConfig(node: StudioNode): GraphObject {
	const config: GraphObject = {};
	const keys = node.type === "iteration.each" ? ["path", "maxIterations", "body"] : node.type === "gate.compare" ? ["path", "operator", "right"] : node.type === "gate.member" ? ["path", "values"] : node.type === "operation.arithmetic" ? ["operator"] : ["path"];
	for (const key of keys) {
		const value = node.config[key];
		config[key] = ["path", "body", "right", "values"].includes(key) && typeof value === "string" ? JSON.parse(value) : value as GraphValue;
	}
	return config;
}
function studioValue(result: GraphObject): GraphValue { return Object.hasOwn(result, "value") ? result.value! : result; }

async function local(node: StudioNode, values: GraphValue[], options: StudioRunOptions, context: GraphNodeContext): Promise<GraphEmission[]> {
	const value = values[0] ?? null, config = node.config;
	if (!nodePorts(node).inputs.length || (node.type === "bf.column" && !context.inputs.length)) {
		let sample = options.input ?? config.sample ?? {};
		if (node.type === "bf.input" && typeof sample === "string") sample = sample ? JSON.parse(sample) : {};
		return emit(nodePorts(node).outputs[0]!.id, sample);
	}
	switch (node.type) {
		case "transform.template": return emit("text", interpolate(config.template, value));
		case "transform.extract_json": return emit("json", path(JSON.parse(text(value)), config.path));
		case "transform.merge": return emit("merged", values.map(text).join(String(config.separator ?? "\n")));
		case "transform.set": { const additions: unknown = JSON.parse(String(config.values || "{}")); if (!object(value) || !object(additions)) throw new Error("Set values needs JSON objects for both input and values."); return emit("json", { ...value, ...additions }); }
		case "transform.pick": return emit("output", path(value, config.path));
		case "transform.filter": { if (!Array.isArray(value)) throw new Error("Filter needs a JSON list."); const equals: unknown = JSON.parse(String(config.equals)); return emit("json", value.filter(item => JSON.stringify(path(item, config.path)) === JSON.stringify(equals))); }
		case "transform.replace": return emit("text", text(value).replaceAll(required(config.search, "Find text"), String(config.replacement ?? "")));
		case "transform.split": return emit("json", text(value).split(String(config.separator ?? "\n")));
		case "transform.stringify": return emit("text", JSON.stringify(value, null, 2));
		case "route.if": { const result = await evaluate(required(config.condition, "Condition"), { input: value }); if (typeof result !== "boolean") throw new Error("Condition must return a boolean. Read input through context.input."); return emit(result ? "yes" : "no", value); }
		case "route.switch": case "cls.switch": { const selected = text(path(value, config.path)); const ports = nodePorts(node).outputs; const port = ports.find(port => port.id === selected)?.id ?? (ports.some(port => port.id === "unsure") ? "unsure" : undefined); return port ? emit(port, value) : []; }
		case "route.fanout": case "bf.parallel": return nodePorts(node).outputs.flatMap(port => emit(port.id, value));
		case "logic.join": return emit("output", config.mode === "first" ? value : values);
		case "logic.each": { const items = path(value, config.path); if (!Array.isArray(items)) throw new Error("For each needs a JSON list."); return emit("items", items); }
		case "logic.delay": { const seconds = Number(config.seconds); if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error("Wait must be between 0 and 60 seconds."); if (options.mode === "execute") await Bun.sleep(seconds * 1000); return emit("output", value); }
		case "logic.stop": case "bf.done": case "cls.output": return [];
		case "logic.fail": throw new Error(String(config.message || "Stopped by Fail run."));
		case "cls.normalize": { const result = text(value).trim(); return emit("text", config.lowercase ? result.toLowerCase() : result); }
		case "cls.rule": { const matched = config.regex ? await evaluate("new RegExp(context.pattern).test(context.input)", { input: text(value), pattern: String(config.pattern ?? "") }) : text(value).includes(required(config.pattern, "Pattern")); return emit(matched ? "yes" : "no", value); }
		case "bf.column": return emit("output", value);
		case "bf.gate": { const evidence = path(value, config.condition); if (typeof evidence !== "boolean") throw new Error("Gate evidence must be an explicit boolean on the input card."); return emit(evidence ? "yes" : "no", value); }
		default: throw new Error(`No local executor for ${node.type}.`);
	}
}

async function action(node: StudioNode, value: GraphValue, context: GraphNodeContext, actions: GraphNodeRegistry): Promise<GraphEmission[]> {
	const config = node.config;
	if (node.type === "out.move_card" || node.type === "bf.move") {
		if (!object(value)) throw new Error("Move card needs a card object.");
		const id = required(value.id, "Card id"), stateId = required(config.stateId, "Destination column id");
		if (!getTask(id) || !getState(stateId)) throw new Error("The card or destination column no longer exists.");
		const card = updateTask(id, { stateId })!;
		return node.type === "bf.move" ? emit("output", card) : [];
	}
	if (node.type === "out.handle_inbox") {
		const id = required(config.itemId || (object(value) ? value.id : undefined), "Inbox item id");
		if (!getInbox(id)) throw new Error("The inbox item no longer exists.");
		updateInbox(id, { processed: true }); return [];
	}
	let type: string, request: GraphObject;
	if (node.type === "out.create_card") {
		if (!object(value)) throw new Error("Create card needs an input object with a title and optional body/properties.");
		type = "action.create-card";
		const stateId = config.stateId || value.stateId;
		request = { title: value.title ?? "", body: value.body ?? "", ...(stateId ? { stateId: String(stateId) } : {}), ...(value.properties ? { properties: value.properties } : {}), ...(value.cwd !== undefined ? { cwd: value.cwd } : {}) };
	} else if (node.type === "out.file_issue") {
		if (!object(value)) throw new Error("File issue needs an input object with title and body.");
		const [owner, repo] = required(config.repository, "Repository owner/name").split("/");
		type = "action.file-issue"; request = { host: "github.com", owner: owner ?? "", repo: repo ?? "", title: value.title ?? "", body: value.body ?? "" };
	} else {
		type = "action.send-message";
		request = { destination: required(config.channel, "Notification channel"), payload: { kind: required(config.kind, "Notification kind"), level: required(config.level, "Notification level"), title: String(config.title || config.name || "Studio run"), body: text(value) } };
	}
	await actions.get(type)!.execute({ ...context, node: { ...context.node, config: { request } } });
	return [];
}

function isSource(graph: StudioGraph, node: StudioNode): boolean {
	return !nodePorts(node).inputs.length || node.type === "bf.column" && !graph.edges.some(edge => edge.to.node === node.id);
}
function disconnectedNodes(graph: StudioGraph): StudioNode[] {
	const queue = graph.nodes.filter(node => isSource(graph, node)).map(node => node.id);
	const reached = new Set(queue);
	const outgoing = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const targets = outgoing.get(edge.from.node) ?? []; targets.push(edge.to.node); outgoing.set(edge.from.node, targets);
	}
	for (let index = 0; index < queue.length; index++) for (const target of outgoing.get(queue[index]!) ?? []) {
		if (!reached.has(target)) { reached.add(target); queue.push(target); }
	}
	return graph.nodes.filter(node => !reached.has(node.id));
}
function nodeLabel(node: StudioNode): string { return `${String(node.config.name || nodeType(node.type)?.label || node.type)} (${node.id})`; }
export class StudioRunValidationError extends Error {
	constructor(readonly problems: GraphProblem[]) { super(`Graph cannot execute: ${problems.map(problem => problem.message).join("; ")}`); }
}

export async function runStudioGraph(graph: StudioGraph, options: StudioRunOptions = {}): Promise<StudioRun> {
	const mode = options.mode ?? "preview";
	if (!graph.nodes.length) throw new Error("Add a node before running this graph.");
	const unsupported = graph.nodes.filter(node => studioNodeExecution(node.type) === "preview");
	if (mode === "execute" && unsupported.length) throw new Error(`Execution is unavailable for: ${unsupported.map(node => String(node.config.name || nodeType(node.type)!.label)).join(", ")}. These nodes can be saved and previewed; no actions were sent.`);
	const disconnected = disconnectedNodes(graph), disconnectedIds = new Set(disconnected.map(node => node.id));
	if (mode === "execute" && disconnected.length) throw new StudioRunValidationError(disconnected.map(node => ({ nodeId: node.id, message: `Connect ${nodeLabel(node)} to a trigger before executing.` })));
	const runId = crypto.randomUUID(), startedAt = new Date().toISOString();
	const registry = new GraphNodeRegistry(), actions = new GraphNodeRegistry(); registerGraphActions(actions);
	registerGraphActions(registry);
	const skipped = new Map<string, string>();
	const definition: RoutineGraph = { version: 2, nodes: [], edges: graph.edges.filter(edge => !disconnectedIds.has(edge.from.node) && !disconnectedIds.has(edge.to.node)).map(edge => ({ ...edge, from: { nodeId: edge.from.node, port: edge.from.port }, to: { nodeId: edge.to.node, port: edge.to.port } })), budget: { max_duration_secs: 120, max_steps_executed: 10_000 } };
	for (const [index, node] of graph.nodes.entries()) {
		if (disconnectedIds.has(node.id)) continue;
		const ports = nodePorts(node), source = isSource(graph, node);
		if (nativeStudioTypes.has(node.type)) {
			try { definition.nodes.push({ id: node.id, type: node.type, config: nativeConfig(node) }); }
			catch (error) { throw new StudioRunValidationError([{ nodeId: node.id, message: `${nodeLabel(node)}: ${error instanceof Error ? error.message : String(error)}` }]); }
			continue;
		}
		const type = `studio.${index}`;
		definition.nodes.push({ id: node.id, type, config: { eventType: "manual" } });
		registry.register({
			definition: { type, label: nodeType(node.type)!.label, kind: source ? "event" : "operation", inputs: source ? [] : ports.inputs.map(port => ({ id: port.id, type: "object", required: false, multiple: true })), outputs: ports.outputs.map(port => ({ id: port.id, type: "object" })) },
			execute: async context => {
				const capability = studioNodeExecution(node.type);
				if (capability !== "local" && mode === "preview") { skipped.set(node.id, "Not executed. Preview never sends inference requests or output actions."); return []; }
				const values = context.inputs.map(input => studioValue(input.output.result));
				return capability === "action" ? action(node, values[0] ?? null, context, actions) : local(node, values, options, context);
			},
		});
	}
	let result: GraphExecutionResult = { status: "success", nodeRuns: [], outputs: [] };
	if (definition.nodes.length) {
		try {
			result = await executeGraph(definition, { eventType: "manual", event: {}, operationId: runId }, registry, { runId, routineId: graph.id, dryRun: mode === "preview" });
		} catch (error) {
			if (!(error instanceof GraphValidationError)) throw error;
			throw new StudioRunValidationError(error.errors.map(problem => {
				const nodeIndex = /^\/nodes\/(\d+)/.exec(problem.path), edgeIndex = /^\/edges\/(\d+)/.exec(problem.path);
				const node = nodeIndex ? graph.nodes.find(node => node.id === definition.nodes[Number(nodeIndex[1])]?.id) : undefined;
				const edge = edgeIndex ? definition.edges[Number(edgeIndex[1])] : undefined;
				return { nodeId: node?.id ?? edge?.to.nodeId, message: `${node ? nodeLabel(node) : edge ? `Connection ${edge.id}` : "Graph"}: ${problem.message.replaceAll("routine graph", "graph")}` };
			}));
		}
	}
	const authored = new Map(graph.nodes.map(node => [node.id, node]));
	const endedAt = new Date().toISOString();
	return {
		id: runId, graphId: graph.id, startedAt, endedAt,
		ok: result.status === "success", trigger: mode === "preview" ? "Manual preview" : "Manual execution", mode,
		nodes: [...result.nodeRuns.map(node => {
			const original = authored.get(node.nodeId)!;
			const output: unknown[] = node.outputs.map(output => ({ port: output.port, value: studioValue(output.result) }));
			for (const effect of node.effects ?? []) output.push({ effect: effect.status, receipt: effect.receipt, destination: effect.destination });
			return {
				nodeId: node.nodeId, startedAt: node.startedAt ?? node.endedAt, endedAt: node.endedAt,
				status: skipped.has(node.nodeId) || node.status === "skipped" ? "skipped" as const : node.status === "success" ? "ok" as const : "failed" as const,
				note: skipped.get(node.nodeId) ?? node.error ?? (node.status === "skipped" ? "No active upstream branch reached this node." : original.type === "cls.output" ? `Classification: ${String(original.config.label ?? "")}` : undefined),
				...(output.length ? { output } : {}),
			};
		}), ...disconnected.map(node => ({
			nodeId: node.id, startedAt: endedAt, endedAt, status: "skipped" as const,
			note: `${nodeLabel(node)} is not connected to a trigger. No work was executed for this node.`,
		}))],
	};
}
