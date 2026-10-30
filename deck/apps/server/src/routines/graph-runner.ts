import {
	INBOX_CARD_ADDED_EVENT, inboxCardAddedNodeType,
	compileStructuredOutputSchema, isGraphValue, validateRoutineGraph,
	type GraphActivation, type GraphEffect, type GraphEmission, type GraphExecutionResult, type GraphNode,
	type GraphNodeInput, type GraphNodeRun, type GraphNodeType, type GraphOutput, type GraphIterationAddress, type GraphObject,
	type GraphValue, type GraphValueType, type RoutineGraph, type ValidationError, type ValidationResult,
} from "@npi-deck/protocol";
import { checkBudget, newBudgetState } from "./budget.ts";
import { graphBuiltins } from "./graph-builtins.ts";

export interface GraphUsage {
	llmTokensIn?: number;
	llmTokensOut?: number;
	llmCostMicros?: number;
}
export interface GraphNodeOutcome {
	status: GraphNodeRun["status"];
	error?: string;
	/** Only a deliberate skip or failure policy can keep the aggregate successful. */
	continue?: boolean;
	abortReason?: GraphExecutionResult["abortReason"];
}
export interface GraphNodeContext {
	node: GraphNode;
	inputs: GraphNodeInput[];
	activation: GraphActivation;
	/** Original trigger, unchanged when activation describes an iteration pass. */
	rootActivation?: GraphActivation;
	signal: AbortSignal;
	runId: string;
	routineId?: string;
	dryRun: boolean;
	/** Shared run start and remaining duration, including routing and retry delays. */
	startedAt?: string;
	remainingDurationMs?(): number;
	iteration?: GraphIterationAddress[];
	/** Previously settled nodes in this graph/pass, in deterministic execution order. */
	priorNodeRuns?: readonly GraphNodeRun[];
	/** Trace details are not outputs and never activate consumers, including on failure. */
	recordDiagnostics?(details: GraphObject): void;
	/** Set the real node result independently of a policy that continues the run. */
	recordOutcome?(outcome: GraphNodeOutcome): void;
	/** Account one completed attempt. Terminal aborts retain their original cause. */
	recordStepAttempt?(usage: GraphUsage, terminal?: boolean): void;
	/** Effects are journaled by actions before writes; retained even on failure/abort. */
	recordEffect(effect: GraphEffect): void;
	/** Report each increment once. Caps are checked immediately; never estimate silently. */
	recordUsage(usage: GraphUsage): void;
	/** Run a validated iteration body with the same cancellation and budget state. */
	iterate?(body: RoutineGraph, items: GraphValue[]): Promise<void>;
}
export interface GraphNodeImplementation {
	definition: GraphNodeType;
	/** Native actions account for retries themselves and settle cooperative abort diagnostics. */
	stepAccounting?: "attempts";
	settlesOnAbort?: boolean;
	execute(context: GraphNodeContext): GraphEmission[] | Promise<GraphEmission[]>;
}
export interface GraphExecutionOptions {
	runId?: string;
	signal?: AbortSignal;
	routineId?: string;
	dryRun?: boolean;
	onNodeRun?: (record: GraphNodeRun) => void | Promise<void>;
}
export class GraphValidationError extends Error {
	constructor(public readonly errors: ValidationError[]) {
		super(`Invalid routine graph: ${errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
		this.name = "GraphValidationError";
	}
}

/** One extensible catalogue shared by validation, execution and the HTTP catalogue. */
export class GraphNodeRegistry {
	private readonly implementations = new Map<string, GraphNodeImplementation>();
	private readonly validators = new Map<string, (config: unknown) => ValidationResult>();

	constructor() {
		this.register({
			definition: inboxCardAddedNodeType,
			execute: ({ activation }) => activation.eventType === INBOX_CARD_ADDED_EVENT
				? [{ port: "event", value: activation.event }] : [],
		});
		this.register({
			definition: {
				type: "event.source", label: "Event source", kind: "event", inputs: [],
				outputs: [{ id: "event", type: "object" }],
				configSchema: {
					type: "object", required: ["eventType"],
					properties: {
						eventType: { type: "string", minLength: 1 }, cron: { type: "string", minLength: 1 },
						webhook: {
							type: "object", required: ["path"],
							properties: { path: { type: "string", pattern: "^/hooks/[a-z][a-z0-9-]*$" }, secret_env: { type: "string", minLength: 1 } },
							additionalProperties: false,
						},
						manualTriggers: {
							type: "array", minItems: 1,
							items: { type: "object", properties: { params_schema: {} }, additionalProperties: false },
						},
						eventTriggers: {
							type: "array", minItems: 1,
							items: { type: "object", required: ["source"], properties: { source: { type: "string", minLength: 1 }, type: { type: "string" }, filter: { type: "string" } }, additionalProperties: false },
						},
					},
					additionalProperties: false,
				},
			},
			execute: ({ node, activation }) => node.config.eventType === activation.eventType
				? [{ port: "event", value: activation.event }] : [],
		});
		for (const implementation of graphBuiltins) this.register({ ...implementation });
	}

	register(implementation: GraphNodeImplementation): void {
		const definition = implementation.definition;
		if (typeof implementation.execute !== "function" || !isGraphValue(definition) || !definition || typeof definition.type !== "string" || !definition.type.trim() || typeof definition.label !== "string" || !definition.label.trim() || !["event", "gate", "operation", "action"].includes(definition.kind) || !Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)) throw new Error("Invalid graph node implementation");
		if (this.implementations.has(definition.type)) throw new Error(`Graph node type already registered: ${definition.type}`);
		if (definition.kind === "event" && definition.inputs.length) throw new Error("Event sources cannot have input ports");
		if (definition.configSchema !== undefined && (definition.configSchema === null || typeof definition.configSchema !== "object" || Array.isArray(definition.configSchema))) throw new Error("Config schema must be a JSON object");
		for (const direction of ["inputs", "outputs"] as const) {
			const ids = new Set<string>();
			for (const port of definition[direction]) {
				if (!port || typeof port.id !== "string" || !port.id.trim() || ids.has(port.id) || !["object", "array", "string", "number", "boolean", "null"].includes(port.type) || (port.label !== undefined && typeof port.label !== "string") || (port.required !== undefined && typeof port.required !== "boolean") || (port.multiple !== undefined && typeof port.multiple !== "boolean")) throw new Error(`Invalid ${direction} port for ${definition.type}`);
				ids.add(port.id);
			}
		}
		// Compile before installing: bad schemas must not poison a previously usable registry.
		const validate = definition.configSchema === undefined ? undefined : compileStructuredOutputSchema(definition.configSchema);
		this.implementations.set(definition.type, implementation);
		if (validate) this.validators.set(definition.type, validate);
	}

	get(type: string): GraphNodeImplementation | undefined { return this.implementations.get(type); }
	describe(): GraphNodeType[] { return [...this.implementations.values()].map((implementation) => implementation.definition); }
	validate(graph: unknown): ValidationResult {
		const result = validateRoutineGraph(graph, this.describe());
		if (!result.valid) return result;
		const errors: ValidationError[] = [];
		const validateConfigs = (definition: RoutineGraph, prefix: string) => {
			let webhookSources = 0;
			for (const [index, node] of definition.nodes.entries()) {
				const path = `${prefix}/nodes/${index}/config`;
				const validation = this.validators.get(node.type)?.(node.config);
				for (const error of validation?.errors ?? []) errors.push({ ...error, path: `${path}${error.path === "/" ? "" : error.path}` });
				if (node.type === "event.source") {
					for (const [field, eventType] of [["webhook", "webhook"], ["manualTriggers", "manual"], ["eventTriggers", "event"]] as const) {
						if (node.config[field] !== undefined && node.config.eventType !== eventType) errors.push({ path: `${path}/${field}`, keyword: "eventType", message: `${field} requires eventType ${eventType}`, params: {} });
					}
					if (node.config.webhook !== undefined && ++webhookSources > 1) errors.push({ path: `${path}/webhook`, keyword: "maxProperties", message: "a routine supports only one webhook registration", params: {} });
				}
				if (node.type === "iteration.each") validateConfigs(node.config.body as unknown as RoutineGraph, `${path}/body`);
			}
		};
		validateConfigs(graph as RoutineGraph, "");
		return errors.length ? { valid: false, errors } : { valid: true };
	}
}

function valueMatches(value: GraphValue, type: GraphValueType): boolean {
	if (type === "object") return true;
	if (type === "array") return Array.isArray(value);
	if (type === "null") return value === null;
	return typeof value === type;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Deterministic DAG run; settle absent branches before considering downstream required inputs. */
export async function executeGraph(graph: RoutineGraph, activation: GraphActivation, registry: GraphNodeRegistry, options: GraphExecutionOptions = {}): Promise<GraphExecutionResult> {
	const validation = registry.validate(graph);
	if (!validation.valid) throw new GraphValidationError(validation.errors ?? []);
	if (!isGraphValue(activation) || !activation || Array.isArray(activation) || typeof activation.eventType !== "string" || !activation.eventType.trim() || !activation.event || typeof activation.event !== "object" || (activation.sourceNodeId !== undefined && (typeof activation.sourceNodeId !== "string" || !graph.nodes.some((node) => node.id === activation.sourceNodeId && registry.get(node.type)!.definition.kind === "event")))) {
		throw new GraphValidationError([{ path: "/activation", keyword: "type", message: "activation requires eventType, an event object or array, and an existing event source when selected", params: {} }]);
	}
	const state = newBudgetState(Date.now);
	const routineMode = graph.execution?.mode === "routine-v1";
	const startedAt = new Date(state.startedAtMs).toISOString();
	const controller = new AbortController();
	let abortReason: GraphExecutionResult["abortReason"];
	let runError: string | undefined;
	let status: GraphExecutionResult["status"] = "success";
	const cancel = () => {
		if (controller.signal.aborted || status === "failed") return;
		abortReason = "cancelled"; runError = message(options.signal?.reason ?? "Graph run cancelled"); controller.abort(options.signal?.reason);
	};
	if (options.signal?.aborted) cancel();
	else options.signal?.addEventListener("abort", cancel, { once: true });
	const abortBudget = (reason: string) => {
		if (controller.signal.aborted || status === "failed") return;
		abortReason = "budget"; runError = reason; controller.abort(new Error(reason));
	};
	const enforceBudget = () => {
		const exceeded = checkBudget(state, graph.budget, Date.now);
		if (exceeded) abortBudget(`Graph budget exceeded: ${exceeded.limit} (${exceeded.value} > ${exceeded.cap})`);
	};
	let deadline: ReturnType<typeof setTimeout> | undefined;
	// Reschedule long deadlines instead of overflowing the platform's signed 32-bit timer.
	const scheduleDeadline = () => {
		const remaining = state.startedAtMs + graph.budget!.max_duration_secs! * 1000 - Date.now();
		if (remaining <= 0) abortBudget("Graph budget exceeded: max_duration_secs");
		else deadline = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
	};
	if (!routineMode && graph.budget?.max_duration_secs !== undefined) scheduleDeadline();
	const runId = options.runId ?? crypto.randomUUID();
	const runBudget = graph.budget;
	const rootActivation = activation;
	const runScope = async (graph: RoutineGraph, activation: GraphActivation, sourceInputs: GraphOutput[] = [], iteration: GraphIterationAddress[] = []): Promise<Pick<GraphExecutionResult, "status" | "nodeRuns" | "outputs">> => {
	const nodeRuns: GraphNodeRun[] = [], outputs: GraphOutput[] = [];
	const incoming = new Map<string, RoutineGraph["edges"]>();
	const outgoing = new Map<string, string[]>();
	const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
	for (const edge of graph.edges) {
		const edges = incoming.get(edge.to.nodeId) ?? []; edges.push(edge); incoming.set(edge.to.nodeId, edges);
		const targets = outgoing.get(edge.from.nodeId) ?? []; targets.push(edge.to.nodeId); outgoing.set(edge.from.nodeId, targets);
		indegree.set(edge.to.nodeId, indegree.get(edge.to.nodeId)! + 1);
	}
	const settled = new Map<string, Map<string, GraphOutput[]>>();
	const emittedValues = new Map<GraphOutput, GraphValue>();
	const pending = new Set(graph.nodes.map((node) => node.id));
		while (pending.size) {
			// Graph declaration order breaks ties, independent of handler timing and edge order.
			const node = graph.nodes.find((candidate) => pending.has(candidate.id) && indegree.get(candidate.id) === 0)!;
			pending.delete(node.id);
			const implementation = registry.get(node.type)!;
			const definition = implementation.definition;
			const inputs: GraphNodeInput[] = [];
			for (const edge of incoming.get(node.id) ?? []) for (const output of settled.get(edge.from.nodeId)?.get(edge.from.port) ?? []) inputs.push({ port: edge.to.port, edgeId: edge.id, output });
			if (definition.kind === "event") for (const output of sourceInputs) inputs.push({ port: "parent", edgeId: "iteration-parent", output });
			const envelopes = inputs.map((input) => input.output);
			const record: GraphNodeRun = { nodeId: node.id, type: node.type, status: "skipped", inputs: envelopes, inputPorts: inputs.map((input) => input.port), outputs: [], endedAt: "", ...(iteration.length ? { iteration } : {}) };
			const selected = definition.kind === "event"
				? (activation.sourceNodeId === undefined || activation.sourceNodeId === node.id) && node.config.eventType === activation.eventType
				: inputs.length > 0 && definition.inputs.every((port) => port.required === false || inputs.some((input) => input.port === port.id));
			if (status === "success" && selected) {
				if (!routineMode) enforceBudget();
				if (!routineMode && !controller.signal.aborted && runBudget?.max_steps_executed !== undefined && state.stepsExecuted >= runBudget.max_steps_executed) abortBudget("Graph budget exceeded: max_steps_executed");
				if (controller.signal.aborted) {
					record.status = "aborted"; record.error = runError; status = routineMode && abortReason === "budget" ? "failed" : "aborted";
				} else {
					record.startedAt = new Date().toISOString();
					let active = true;
					const settlement: { outcome?: GraphNodeOutcome } = {};
					const reportUsage = (usage: GraphUsage) => {
						if (!active) throw new Error("Cannot report usage after graph node settled");
						if (!usage || typeof usage !== "object" || Array.isArray(usage)) throw new Error("Invalid graph usage");
						for (const [key, value] of Object.entries(usage)) if (!["llmTokensIn", "llmTokensOut", "llmCostMicros"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || (key !== "llmCostMicros" && !Number.isInteger(value))) throw new Error(`Invalid graph usage: ${key}`);
						if (!Number.isFinite(state.totalTokensIn + (usage.llmTokensIn ?? 0)) || !Number.isFinite(state.totalTokensOut + (usage.llmTokensOut ?? 0)) || !Number.isFinite(state.totalCostMicros + (usage.llmCostMicros ?? 0))) throw new Error("Graph usage totals overflowed");
						state.totalTokensIn += usage.llmTokensIn ?? 0;
						state.totalTokensOut += usage.llmTokensOut ?? 0;
						state.totalCostMicros += usage.llmCostMicros ?? 0;
					};
					try {
						for (const port of definition.inputs) {
							const values = inputs.filter((input) => input.port === port.id);
							if (!port.multiple && values.length > 1) throw new Error(`Input port ${port.id} accepts only one value`);
							for (const input of values) if (!valueMatches(emittedValues.get(input.output)!, port.type)) throw new Error(`Input port ${port.id} expected ${port.type}`);
						}
						const context: GraphNodeContext = {
							node, inputs, activation, rootActivation, signal: controller.signal, runId, iteration, priorNodeRuns: nodeRuns,
							routineId: options.routineId, dryRun: options.dryRun === true,
							startedAt,
							remainingDurationMs: () => runBudget?.max_duration_secs === undefined ? Infinity : state.startedAtMs + runBudget.max_duration_secs * 1000 - Date.now(),
							recordEffect: (effect) => {
								record.effects ??= [];
								const index = record.effects.findIndex((item) => item.logicalKey === effect.logicalKey);
								if (index < 0) record.effects.push(effect); else record.effects[index] = effect;
							},
							recordDiagnostics: (details) => {
								if (!active) throw new Error("Cannot record diagnostics after graph node settled");
								if (!isGraphValue(details) || details === null || typeof details !== "object" || Array.isArray(details)) throw new Error("Graph diagnostics must be a JSON object");
								record.diagnostics = details;
							},
							recordOutcome: (result) => {
								if (!active) throw new Error("Cannot record outcome after graph node settled");
								if (!["success", "skipped", "failed", "aborted"].includes(result.status) || (result.continue && result.status !== "skipped" && result.status !== "failed")) throw new Error("Invalid graph node outcome");
								settlement.outcome = result;
							},
							recordStepAttempt: (usage, terminal = false) => {
								if (implementation.stepAccounting !== "attempts") throw new Error("Only attempt-accounted nodes can report attempts");
								reportUsage(usage);
								state.stepsExecuted++;
								if (!terminal) {
									enforceBudget();
									controller.signal.throwIfAborted();
								}
							},
							recordUsage: (usage) => {
								reportUsage(usage);
								enforceBudget();
								controller.signal.throwIfAborted();
							},
							iterate: async (body, items) => {
								if (node.type !== "iteration.each") throw new Error("Only iteration.each can execute an iteration body");
								record.passes = [];
								for (const [index, item] of items.entries()) {
									enforceBudget(); controller.signal.throwIfAborted();
									const pass = await runScope(body, { eventType: "iteration", event: { item, index, count: items.length }, operationId: activation.operationId }, envelopes, [...iteration, { nodeId: node.id, index }]);
									record.passes.push({ index, status: pass.status, nodeRuns: pass.nodeRuns, outputs: pass.outputs });
									if (pass.status !== "success") { controller.signal.throwIfAborted(); throw new Error(runError ?? "Iteration body failed"); }
								}
							},
						};
						if (!routineMode && implementation.stepAccounting !== "attempts") state.stepsExecuted++;
						const emissions = node.type === "iteration.each" || implementation.settlesOnAbort
							? await implementation.execute(context)
							: await withAbort(() => implementation.execute(context), controller.signal);
						if (!routineMode) enforceBudget();
						controller.signal.throwIfAborted();
						if (!Array.isArray(emissions)) throw new Error("Node must return an array of emissions");
						const counts = new Map<string, number>();
						for (const emission of emissions) {
							if (!emission || typeof emission.port !== "string") throw new Error("Emission requires a named output port");
							const port = definition.outputs.find((candidate) => candidate.id === emission.port);
							if (!port) throw new Error(`Unknown output port: ${emission.port}`);
							if (!isGraphValue(emission.value)) throw new Error(`Output port ${port.id} returned non-JSON, nonfinite or cyclic data`);
							if (!valueMatches(emission.value, port.type)) throw new Error(`Output port ${port.id} expected ${port.type}`);
							if (emission.includeSiblingOutputs !== undefined && (!Array.isArray(emission.includeSiblingOutputs) || new Set(emission.includeSiblingOutputs).size !== emission.includeSiblingOutputs.length || emission.includeSiblingOutputs.some(port => typeof port !== "string" || !counts.has(port)))) throw new Error("Emission ancestry must name earlier output ports from the same batch");
							counts.set(port.id, (counts.get(port.id) ?? 0) + 1);
							if (!port.multiple && counts.get(port.id)! > 1) throw new Error(`Output port ${port.id} accepts only one emission`);
						}
						// Validate the whole batch before exposing any part of it to consumers.
						for (const emission of emissions) {
							const value = emission.value;
							const passOutputs = record.passes?.flatMap(pass => pass.outputs) ?? [];
							const siblingOutputs = emission.includeSiblingOutputs ? record.outputs.filter(output => emission.includeSiblingOutputs!.includes(output.port)) : [];
							// Earlier siblings already retain the original inputs transitively.
							const output: GraphOutput = { nodeId: node.id, port: emission.port, result: value !== null && typeof value === "object" && !Array.isArray(value) ? value : { value }, inputs: siblingOutputs.length ? siblingOutputs : passOutputs.length ? [...envelopes, ...passOutputs] : envelopes, ...(iteration.length ? { iteration } : {}) };
							record.outputs.push(output); emittedValues.set(output, value);
						}
						const outcome = settlement.outcome;
						record.status = outcome?.status ?? "success";
						if (outcome?.error !== undefined) record.error = outcome.error;
						if (outcome && outcome.status !== "success" && !outcome.continue) {
							abortReason = outcome.abortReason;
							status = outcome.status === "aborted" && !(routineMode && abortReason === "timeout") ? "aborted" : "failed";
							runError = outcome.error;
						}
					} catch (error) {
						const cancelled = controller.signal.aborted && error === controller.signal.reason;
						record.status = cancelled ? settlement.outcome?.status ?? "aborted" : "failed";
						record.error = cancelled ? settlement.outcome?.error ?? runError : message(error);
						if (cancelled) {
							status = routineMode && abortReason === "budget" ? "failed" : "aborted";
						} else {
							status = "failed";
							if (routineMode) abortReason ??= "failure";
							runError = record.error;
						}
					} finally { active = false; }
				}
			}
			const ports = new Map<string, GraphOutput[]>();
			for (const output of record.outputs) { const list = ports.get(output.port) ?? []; list.push(output); ports.set(output.port, list); }
			settled.set(node.id, ports);
			outputs.push(...record.outputs);
			record.endedAt = new Date().toISOString(); nodeRuns.push(record);
			if (!iteration.length) await options.onNodeRun?.(record);
			for (const target of outgoing.get(node.id) ?? []) indegree.set(target, indegree.get(target)! - 1);
		}
		return { nodeRuns, outputs, status };
	};
	try {
		const result = await runScope(graph, activation);
		if (controller.signal.aborted && status === "success") status = routineMode && abortReason === "budget" ? "failed" : "aborted";
		return { ...result, status, dryRun: options.dryRun === true, ...(runError !== undefined ? { error: runError } : {}), ...((status === "aborted" || routineMode && status === "failed") && abortReason ? { abortReason } : {}), usage: { llmTokensIn: state.totalTokensIn, llmTokensOut: state.totalTokensOut, llmCostMicros: state.totalCostMicros, stepsExecuted: state.stepsExecuted } };
	} finally {
		if (deadline !== undefined) clearTimeout(deadline);
		options.signal?.removeEventListener("abort", cancel);
	}
}

function withAbort<T>(execute: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) { reject(signal.reason); return; }
		const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
		signal.addEventListener("abort", abort, { once: true });
		try {
			Promise.resolve(execute()).then(
				(value) => { signal.removeEventListener("abort", abort); resolve(value); },
				(error) => { signal.removeEventListener("abort", abort); reject(error); },
			);
		} catch (error) { signal.removeEventListener("abort", abort); reject(error); }
	});
}

/** Address the envelope itself, e.g. ["inputs", 0, "result", "message"]. Own keys only. */
export function readGraphPath(output: GraphOutput, path: readonly (string | number)[]): GraphValue | undefined {
	let value: unknown = output;
	for (const key of path) {
		if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
		value = (value as Record<string | number, unknown>)[key];
	}
	return value as GraphValue | undefined;
}
/** Find the nearest matching upstream envelope, optionally selecting an exact pass address. */
export function findGraphOutput(output: GraphOutput, nodeId: string, port?: string, iteration?: readonly GraphIterationAddress[]): GraphOutput | undefined {
	const queue = [output], seen = new Set<GraphOutput>();
	for (let index = 0; index < queue.length; index++) {
		const current = queue[index]!;
		if (seen.has(current)) continue;
		seen.add(current);
		if (current.nodeId === nodeId && (port === undefined || current.port === port) && (iteration === undefined || JSON.stringify(current.iteration ?? []) === JSON.stringify(iteration))) return current;
		queue.push(...current.inputs);
	}
	return undefined;
}
