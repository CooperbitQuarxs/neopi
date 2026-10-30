import { isGraphValue, type GraphEmission, type GraphObject, type GraphOutput, type RoutineStep } from "@npi-deck/protocol";
import commonSchema from "../../../../packages/protocol/src/schemas/step-common.json";
import runSchema from "../../../../packages/protocol/src/schemas/step-run.json";
import writeSchema from "../../../../packages/protocol/src/schemas/step-write.json";
import httpSchema from "../../../../packages/protocol/src/schemas/step-http.json";
import deckSchema from "../../../../packages/protocol/src/schemas/step-deck.json";
import mcpSchema from "../../../../packages/protocol/src/schemas/step-mcp.json";
import transformSchema from "../../../../packages/protocol/src/schemas/step-transform.json";
import waitSchema from "../../../../packages/protocol/src/schemas/step-wait.json";
import stateSchema from "../../../../packages/protocol/src/schemas/step-set_state.json";
import { loadConfig } from "../config.ts";
import { getRun } from "../db/routines.ts";
import type { GraphNodeContext, GraphNodeRegistry } from "./graph-runner.ts";
import { evaluate } from "./sandbox.ts";
import { loadState } from "./state.ts";
import { executeRunStep } from "./steps/run.ts";
import { executeWriteStep } from "./steps/write.ts";
import { executeHttpStep } from "./steps/http.ts";
import { executeDeckStep } from "./steps/deck.ts";
import { executeMcpStep } from "./steps/mcp.ts";
import { executeTransformStep } from "./steps/transform.ts";
import { executeWaitStep } from "./steps/wait.ts";
import { executeSetStateStep } from "./steps/set_state.ts";
import type { RunContext, StepContextEntry, StepResult } from "./types.ts";

const schemas = { run: runSchema, write: writeSchema, http: httpSchema, deck: deckSchema, mcp: mcpSchema, transform: transformSchema, wait: waitSchema, set_state: stateSchema };
export const nativeStepTypes = Object.keys(schemas);

/** Use the exact action schemas, including the controls executed by native nodes. */
function configSchema(schema: unknown): GraphObject {
	const inline = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(inline);
		if (!value || typeof value !== "object") return value;
		if ("$ref" in value && value.$ref === commonSchema.$id) return inline(commonSchema);
		return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$id" && key !== "$schema").map(([key, item]) => [key, inline(item)]));
	};
	return { type: "object", required: ["step"], properties: { step: { ...inline(schema) as GraphObject, unevaluatedProperties: false }, cwd: { type: "string" } }, additionalProperties: false };
}

/** Project legacy access from the shared native trace; original outputs stay intact. */
function runContext(context: GraphNodeContext): RunContext {
	const started = context.startedAt ?? context.priorNodeRuns?.find(record => record.startedAt)?.startedAt ?? getRun(context.runId)?.startedAt ?? new Date().toISOString();
	const ancestors = new Set<string>();
	const visited = new Set<GraphOutput>();
	const visit = (output: GraphOutput) => {
		if (visited.has(output)) return;
		visited.add(output);
		ancestors.add(output.nodeId);
		output.inputs.forEach(visit);
	};
	context.inputs.forEach(input => visit(input.output));
	const entries: Record<string, StepContextEntry> = {};
	let state: Record<string, unknown> | undefined;
	for (const record of context.priorNodeRuns ?? []) {
		const diagnostic = record.diagnostics;
		if (!ancestors.has(record.nodeId) || !record.type.startsWith("step.") || !diagnostic || typeof diagnostic.stepId !== "string") continue;
		const entry = diagnostic.entry;
		if (entry && typeof entry === "object" && !Array.isArray(entry)) entries[diagnostic.stepId] = entry as unknown as StepContextEntry;
		if (diagnostic.state && typeof diagnostic.state === "object" && !Array.isArray(diagnostic.state)) state = diagnostic.state;
	}
	return {
		run: { id: context.runId, started, iso_started: started, date: started.slice(0, 10), trigger_kind: context.activation.eventType as RunContext["run"]["trigger_kind"] },
		trigger: context.activation.event as Record<string, unknown>, steps: entries,
		env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
		secrets: {}, state: state ? structuredClone(state) : context.routineId ? loadState(context.routineId) : {},
	};
}
type NativeStepExecutor = (step: RoutineStep, context: RunContext, signal: AbortSignal, cwd: string, graph: GraphNodeContext) => Promise<StepResult>;
const dispatch: NativeStepExecutor = async (step, context, signal, cwd, graph) => {
	switch (step.type) {
		case "run": return executeRunStep(step, context, signal, cwd);
		case "write": return executeWriteStep(step, context, signal, cwd);
		case "http": return executeHttpStep(step, context, signal, graph.runId);
		case "deck": return executeDeckStep(step, context, signal);
		case "mcp": return executeMcpStep(step, context, signal, cwd);
		case "transform": return executeTransformStep(step, context, signal);
		case "wait": return executeWaitStep(step, context, signal);
		case "set_state": {
			if (!graph.routineId) throw new Error("State nodes require a persisted routine");
			return executeSetStateStep(step, context, signal, graph.routineId);
		}
		default: throw new Error(`Unsupported native step: ${step.type}`);
	}
};

function entryFor(result: StepResult): StepContextEntry {
	const entry: StepContextEntry = { status: result.status, stdout: result.stdoutExcerpt, stderr: result.stderrExcerpt, duration_ms: result.durationMs };
	if (result.json !== undefined) entry.json = result.json;
	if (result.error !== undefined) entry.error = result.error;
	if (result.model !== undefined) entry.model = result.model;
	if (result.llmTokensIn != null) entry.tokens = { in: result.llmTokensIn, out: result.llmTokensOut ?? 0 };
	return entry;
}

interface StepAttempt {
	attempt: number;
	startedAt: string;
	endedAt: string;
	timedOut: boolean;
	result: StepResult;
}

function recordDiagnostics(graph: GraphNodeContext, details: unknown): void {
	const diagnostic: unknown = JSON.parse(JSON.stringify(details));
	if (!isGraphValue(diagnostic) || diagnostic === null || typeof diagnostic !== "object" || Array.isArray(diagnostic)) throw new Error("Step returned non-JSON diagnostics");
	graph.recordDiagnostics?.(diagnostic);
}

async function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	await new Promise<void>(resolve => {
		const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
		const timer = setTimeout(finish, ms);
		signal.addEventListener("abort", finish, { once: true });
	});
	signal.throwIfAborted();
}

async function executeNativeStep(graph: GraphNodeContext, step: RoutineStep, executeStep: NativeStepExecutor): Promise<GraphEmission[]> {
	// Preview never evaluates a condition or dispatches an action.
	if (graph.dryRun) return [];
	graph.signal.throwIfAborted();
	const context = runContext(graph);
	const completed = (status: StepResult["status"]): GraphEmission => ({ port: "completed", value: { stepId: step.id, status } });
	let whenError: string | undefined;
	const predicate: GraphObject = step.when ? { whenExpression: step.when } : {};
	if (step.when) {
		let truthy: unknown;
		try {
			truthy = await evaluate(step.when, context as unknown as Record<string, unknown>);
			if (isGraphValue(truthy)) predicate.whenValue = truthy;
			else predicate.whenValueRepresentation = { type: typeof truthy, text: String(truthy) };
		}
		catch (error) { whenError = error instanceof Error ? error.message : String(error); truthy = false; }
		graph.signal.throwIfAborted();
		if (!truthy) {
			const entry: StepContextEntry = { status: "skipped", stdout: "", stderr: "", duration_ms: 0 };
			recordDiagnostics(graph, { stepId: step.id, entry, state: context.state, attempts: [], timedOut: false, ...predicate, whenError });
			graph.recordOutcome?.({ status: "skipped", continue: true });
			return [completed("skipped")];
		}
	}
	const attempts: StepAttempt[] = [];
	const attemptCap = step.on_failure === "retry" ? step.retry?.times ?? 1 : 1;
	let finalResult: StepResult | undefined;
	let timedOut = false;
	const trace = () => recordDiagnostics(graph, { stepId: step.id, entry: finalResult ? entryFor(finalResult) : undefined, state: context.state, result: finalResult, attempts, timedOut, ...predicate });
	try {
		for (let attempt = 1; attempt <= Math.max(1, attemptCap); attempt++) {
			graph.signal.throwIfAborted();
			const startedMs = Date.now();
			const controller = new AbortController();
			const abort = () => controller.abort(graph.signal.reason);
			graph.signal.addEventListener("abort", abort, { once: true });
			if (graph.signal.aborted) abort();
			const remainingMs = Math.min((step.timeout_secs ?? 60) * 1000, graph.remainingDurationMs?.() ?? Infinity);
			let timer: ReturnType<typeof setTimeout> | undefined;
			let result: StepResult;
			try {
				if (remainingMs <= 0) {
					timedOut = true;
					result = { status: "aborted", stdoutExcerpt: "", stderrExcerpt: "", error: "step timed out", durationMs: 0 };
				} else {
					timer = setTimeout(() => { timedOut = true; controller.abort(new Error("step timed out")); }, remainingMs);
					try {
						controller.signal.throwIfAborted();
						result = await executeStep(step, context, controller.signal, graph.node.config.cwd as string | undefined ?? loadConfig().defaultCwd, graph);
					} catch (error) {
						result = { status: controller.signal.aborted ? "aborted" : "failed", stdoutExcerpt: "", stderrExcerpt: "", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedMs };
					}
					if (timedOut) result = { ...result, status: "aborted", error: "step timed out" };
					else if (graph.signal.aborted) result = { ...result, status: "aborted", error: result.error ?? "aborted" };
				}
			} finally {
				if (timer !== undefined) clearTimeout(timer);
				graph.signal.removeEventListener("abort", abort);
			}
			finalResult = result;
			attempts.push({ attempt, startedAt: new Date(startedMs).toISOString(), endedAt: new Date().toISOString(), timedOut, result });
			trace();
			const terminal = timedOut || graph.signal.aborted || result.status === "aborted";
			graph.recordStepAttempt?.({
				...(result.llmTokensIn != null ? { llmTokensIn: result.llmTokensIn } : {}),
				...(result.llmTokensOut != null ? { llmTokensOut: result.llmTokensOut } : {}),
				...(result.llmCostMicros != null ? { llmCostMicros: result.llmCostMicros } : {}),
			}, terminal);
			if (terminal || result.status === "success") break;
			if (attempt < attemptCap) {
				const delaySecs = Math.min(step.retry?.backoff === "linear" ? attempt : 2 ** (attempt - 1), step.retry?.max_delay_secs ?? 60);
				await retryDelay(delaySecs * 1000, graph.signal);
			}
		}
	} finally {
		if (finalResult) {
			trace();
			const effective = step.on_failure === "retry" ? step.retry?.after_retry ?? "abort" : step.on_failure ?? "abort";
			graph.recordOutcome?.({
				status: finalResult.status,
				...(finalResult.error !== undefined ? { error: finalResult.error } : {}),
				...(finalResult.status === "skipped" || finalResult.status === "failed" && effective === "continue" ? { continue: true } : {}),
				...(timedOut ? { abortReason: "timeout" } : finalResult.status === "aborted" ? { abortReason: "cancelled" } : finalResult.status === "failed" && effective !== "continue" ? { abortReason: "failure" } : {}),
			});
		}
	}
	graph.signal.throwIfAborted();
	if (!finalResult) throw new Error("no result produced");
	if (finalResult.status === "success") {
		const value = finalResult.json === undefined ? finalResult.stdoutExcerpt : finalResult.json;
		if (!isGraphValue(value)) throw new Error("Step returned a non-JSON value");
		return [{ port: "result", value }, { ...completed("success"), includeSiblingOutputs: ["result"] }];
	}
	if (finalResult.status === "skipped" || finalResult.status === "failed" && (step.on_failure === "continue" || step.on_failure === "retry" && step.retry?.after_retry === "continue")) return [completed(finalResult.status)];
	return [];
}

/** Native actions also available to newly authored graphs. No YAML is read at execution. */
export function registerGraphStepNodes(registry: GraphNodeRegistry, executeStep: NativeStepExecutor = dispatch): void {
	for (const [type, schema] of Object.entries(schemas)) registry.register({
		definition: {
			type: `step.${type}`, label: `Routine ${type}`, kind: type === "transform" || type === "wait" ? "operation" : "action",
			inputs: [{ id: "in", type: "object", multiple: true }],
			outputs: [{ id: "result", type: "object" }, { id: "completed", type: "object" }],
			configSchema: configSchema(schema),
		},
		stepAccounting: "attempts",
		settlesOnAbort: true,
		execute: graph => {
			const step = graph.node.config.step as unknown as RoutineStep;
			if (step.type !== type) throw new Error("Step type must match native node type");
			return executeNativeStep(graph, step, executeStep);
		},
	});
}
