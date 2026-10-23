import { expect, test } from "bun:test";
import type { GraphObject, GraphOutput, RoutineBudget, RoutineGraph, RoutineStep } from "@npi-deck/protocol";
import { executeGraph, findGraphOutput, GraphNodeRegistry } from "./graph-runner.ts";
import { registerGraphStepNodes } from "./graph-step-nodes.ts";
import type { RunContext, StepContextEntry, StepResult } from "./types.ts";

type Executor = NonNullable<Parameters<typeof registerGraphStepNodes>[1]>;
const activation = () => ({ eventType: "manual", event: { message: "original", nested: { count: 3 } } });
const transform = (id: string, controls: Partial<Extract<RoutineStep, { type: "transform" }>> = {}): RoutineStep => ({ id, type: "transform", body: "true", ...controls });
const success = (json: unknown = { actual: true }): StepResult => ({ status: "success", stdoutExcerpt: "actual stdout", stderrExcerpt: "actual stderr", durationMs: 7, json });
const failed = (): StepResult => ({ status: "failed", stdoutExcerpt: "partial stdout", stderrExcerpt: "actual stderr", error: "actual failure", durationMs: 9, json: { partial: true } });
function graphFor(steps: RoutineStep[], budget?: RoutineBudget): RoutineGraph {
	return {
		version: 2, execution: { mode: "routine-v1" }, ...(budget ? { budget } : {}),
		nodes: [{ id: "source", type: "event.source", config: { eventType: "manual" } }, ...steps.map(step => ({ id: step.id, type: `step.${step.type}`, config: { step: step as unknown as GraphObject, cwd: process.cwd() } }))],
		edges: steps.map((step, index) => ({ id: `edge-${index}`, from: { nodeId: index ? steps[index - 1]!.id : "source", port: index ? "completed" : "event" }, to: { nodeId: step.id, port: "in" } })),
	};
}
function registryFor(execute?: Executor): GraphNodeRegistry {
	const registry = new GraphNodeRegistry();
	registerGraphStepNodes(registry, execute);
	return registry;
}
function output(result: Awaited<ReturnType<typeof executeGraph>>, nodeId: string, port = "result"): GraphOutput {
	return result.outputs.find(item => item.nodeId === nodeId && item.port === port)!;
}

for (const [label, when, executes, conditionError, expectedValue] of [
	["truthy nonboolean", "'yes'", true, false, "yes"],
	["false", "false", false, false, false],
	["zero", "0", false, false, 0],
	["null", "null", false, false, null],
	["empty evaluated string", "''", false, false, ""],
	["expression error", "throw new Error('broken condition')", false, true, undefined],
	["empty expression bypass", "", true, false, undefined],
] as const) {
	test(`native when ${label} preserves sequential completion and original inputs`, async () => {
		const calls: string[] = [];
		let nextContext: RunContext | undefined;
		const registry = registryFor(async (step, context) => {
			calls.push(step.id);
			if (step.id === "next") nextContext = context;
			return success(step.id === "first" ? [0, false, null] : { next: true });
		});
		const event = activation();
		const graph = graphFor([transform("first", { when }), transform("next")]);
		const result = await executeGraph(graph, event, registry);
		expect(result.status).toBe("success");
		expect(calls).toEqual(executes ? ["first", "next"] : ["next"]);
		expect(result.nodeRuns[1]!.status).toBe(executes ? "success" : "skipped");
		expect(result.usage!.stepsExecuted).toBe(executes ? 2 : 1);
		expect(nextContext!.steps.first!.status).toBe(executes ? "success" : "skipped");
		if (!executes) expect(nextContext!.steps.first).toEqual({ status: "skipped", stdout: "", stderr: "", duration_ms: 0 });
		expect(output(result, "first", "completed").result).toEqual({ stepId: "first", status: executes ? "success" : "skipped" });
		expect(findGraphOutput(output(result, "next"), "source")!.result).toBe(event.event);
		expect(result.nodeRuns[1]!.inputs[0]).toBe(output(result, "source", "event"));
		if (executes) {
			expect(output(result, "first").result).toEqual({ value: [0, false, null] });
			expect(findGraphOutput(output(result, "next"), "first", "result")).toBe(output(result, "first"));
		} else expect(output(result, "first")).toBeUndefined();
		if (conditionError) expect(result.nodeRuns[1]!.diagnostics!.whenError).toContain("broken condition");
		if (when) expect(result.nodeRuns[1]!.diagnostics!.whenExpression).toBe(when);
		if (when && !conditionError) expect(result.nodeRuns[1]!.diagnostics!.whenValue).toBe(expectedValue);
		else expect(result.nodeRuns[1]!.diagnostics).not.toHaveProperty("whenValue");
	});
}

test("native successful result edges still deliver the unmodified action value", async () => {
	const graph = graphFor([transform("first"), transform("next")]);
	graph.edges[1]!.from.port = "result";
	const value = { exact: [1, false, null] };
	const registry = registryFor(async step => success(step.id === "first" ? value : "done"));
	const result = await executeGraph(graph, activation(), registry);
	expect(result.status).toBe("success");
	expect(output(result, "first").result).toBe(value);
	expect(result.nodeRuns[2]!.inputs[0]).toBe(output(result, "first"));
});

test("continued failure retains failed trace and all legacy context without a successful result", async () => {
	let context: RunContext | undefined;
	const registry = registryFor(async (step, ctx) => {
		if (step.id === "first") return { ...failed(), model: "actual-model", llmTokensIn: 2, llmTokensOut: 3, llmCostMicros: 7 };
		context = ctx;
		return success(false);
	});
	const result = await executeGraph(graphFor([transform("first", { on_failure: "continue" }), transform("next")]), activation(), registry);
	expect(result.status).toBe("success");
	expect(result.error).toBeUndefined();
	expect(result.nodeRuns[1]).toMatchObject({ status: "failed", error: "actual failure", diagnostics: { entry: { status: "failed", stdout: "partial stdout", stderr: "actual stderr", error: "actual failure", model: "actual-model", tokens: { in: 2, out: 3 }, duration_ms: 9, json: { partial: true } } } });
	expect(context!.steps.first).toEqual(result.nodeRuns[1]!.diagnostics!.entry as unknown as StepContextEntry);
	expect(output(result, "first")).toBeUndefined();
	expect(output(result, "first", "completed").result).toEqual({ stepId: "first", status: "failed" });
	expect(output(result, "next").result).toEqual({ value: false });
	expect(findGraphOutput(output(result, "next"), "source")!.result).toEqual(activation().event);
	expect(result.usage).toEqual({ llmTokensIn: 2, llmTokensOut: 3, llmCostMicros: 7, stepsExecuted: 2 });
});

test("failed result-only branches remain inactive while completion consumers continue", async () => {
	const graph = graphFor([transform("first", { on_failure: "continue" }), transform("next")]);
	graph.nodes.push({ id: "result_only", type: "step.transform", config: { step: transform("result_only") as unknown as GraphObject } });
	graph.edges.push({ id: "result-only", from: { nodeId: "first", port: "result" }, to: { nodeId: "result_only", port: "in" } });
	const calls: string[] = [];
	const registry = registryFor(async step => { calls.push(step.id); return step.id === "first" ? failed() : success(); });
	const result = await executeGraph(graph, activation(), registry);
	expect(result.status).toBe("success");
	expect(calls).toEqual(["first", "next"]);
	expect(result.nodeRuns.find(run => run.nodeId === "result_only")!.status).toBe("skipped");
});

for (const backoff of ["linear", "exponential"] as const) {
	test(`native ${backoff} retry recovers with real final output and all attempt usage`, async () => {
		let calls = 0;
		const signals: AbortSignal[] = [];
		const registry = registryFor(async (_step, _context, signal) => {
			signals.push(signal);
			return ++calls === 1 ? { ...failed(), llmTokensIn: 3, llmTokensOut: 4, llmCostMicros: 5 } : { ...success(0), llmTokensIn: 7, llmTokensOut: 8, llmCostMicros: 9 };
		});
		const graph = graphFor([transform("first", { on_failure: "retry", retry: { times: 3, backoff, max_delay_secs: 0 } })]);
		const result = await executeGraph(graph, activation(), registry);
		expect(result.status).toBe("success");
		expect(calls).toBe(2);
		expect(signals[0]).not.toBe(signals[1]);
		expect(signals.every(signal => !signal.aborted)).toBe(true);
		expect(output(result, "first").result).toEqual({ value: 0 });
		expect(result.nodeRuns[1]!.diagnostics!.attempts).toMatchObject([{ attempt: 1, timedOut: false, result: { status: "failed", error: "actual failure" } }, { attempt: 2, timedOut: false, result: { status: "success", json: 0 } }]);
		expect(result.usage).toEqual({ llmTokensIn: 10, llmTokensOut: 12, llmCostMicros: 14, stepsExecuted: 2 });
	});
}

for (const after_retry of ["abort", "continue"] as const) {
	test(`retry exhaustion honors after_retry ${after_retry} without rewriting failed actions`, async () => {
		const calls: string[] = [];
		const registry = registryFor(async step => { calls.push(step.id); return step.id === "first" ? failed() : success(); });
		const graph = graphFor([transform("first", { on_failure: "retry", retry: { times: 2, backoff: "exponential", max_delay_secs: 0, after_retry } }), transform("next")]);
		const result = await executeGraph(graph, activation(), registry);
		expect(result.status).toBe(after_retry === "abort" ? "failed" : "success");
		expect(result.abortReason).toBe(after_retry === "abort" ? "failure" : undefined);
		expect(calls).toEqual(after_retry === "abort" ? ["first", "first"] : ["first", "first", "next"]);
		expect(result.nodeRuns[1]!.status).toBe("failed");
		expect(result.nodeRuns[1]!.diagnostics!.attempts).toHaveLength(2);
		expect(output(result, "first")).toBeUndefined();
		expect(Boolean(output(result, "first", "completed"))).toBe(after_retry === "continue");
	});
}

test("executor exceptions become retriable failures with actual error diagnostics", async () => {
	let calls = 0;
	const registry = registryFor(async () => { if (++calls === 1) throw new Error("thrown executor failure"); return success(null); });
	const result = await executeGraph(graphFor([transform("first", { on_failure: "retry", retry: { times: 2, backoff: "linear", max_delay_secs: 0 } })]), activation(), registry);
	expect(result.status).toBe("success");
	expect(result.nodeRuns[1]!.diagnostics!.attempts).toMatchObject([{ result: { status: "failed", error: "thrown executor failure" } }, { result: { status: "success", json: null } }]);
	expect(output(result, "first").result).toEqual({ value: null });
});

test("active cancellation waits for actual aborted attempt diagnostics and never continues or retries", async () => {
	const controller = new AbortController();
	let calls = 0;
	const registry = registryFor(async (_step, _context, signal) => {
		calls++;
		await new Promise<void>(resolve => {
			signal.addEventListener("abort", () => { setTimeout(resolve, 5); }, { once: true });
			queueMicrotask(() => controller.abort(new Error("owner cancellation")));
		});
		return { ...failed(), status: "aborted", error: "actual cancellation receipt", llmTokensIn: 6 };
	});
	const result = await executeGraph(graphFor([transform("first", { on_failure: "retry", retry: { times: 3, backoff: "linear", after_retry: "continue" } }), transform("next")], { max_llm_tokens_input: 0 }), activation(), registry, { signal: controller.signal });
	expect(result.status).toBe("aborted");
	expect(result.abortReason).toBe("cancelled");
	expect(calls).toBe(1);
	expect(result.nodeRuns[1]).toMatchObject({ status: "aborted", error: "actual cancellation receipt", diagnostics: { entry: { stdout: "partial stdout", stderr: "actual stderr" }, result: { status: "aborted", llmTokensIn: 6 }, attempts: [{ attempt: 1 }] } });
	expect(result.usage!.llmTokensIn).toBe(6);
	expect(output(result, "first", "completed")).toBeUndefined();
});

test("cancellation during retry backoff stops without dispatching another attempt", async () => {
	const controller = new AbortController();
	let calls = 0;
	const registry = registryFor(async () => { calls++; setTimeout(() => controller.abort(new Error("stop retry delay")), 5); return failed(); });
	const result = await executeGraph(graphFor([transform("first", { on_failure: "retry", retry: { times: 3, backoff: "exponential" } })]), activation(), registry, { signal: controller.signal });
	expect(result.status).toBe("aborted");
	expect(result.abortReason).toBe("cancelled");
	expect(calls).toBe(1);
	expect(result.nodeRuns[1]!.diagnostics!.attempts).toHaveLength(1);
	expect(result.usage!.stepsExecuted).toBe(1);
});

test("routine duration clips the attempt deadline and retains timeout rather than budget cause", async () => {
	let calls = 0;
	const registry = registryFor(async (_step, _context, signal) => {
		calls++;
		await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
		return { ...failed(), status: "aborted", error: "aborted by transport" };
	});
	const graph = graphFor([transform("first", { timeout_secs: 20, on_failure: "retry", retry: { times: 3, backoff: "linear", after_retry: "continue" } }), transform("next")], { max_duration_secs: 1 });
	const result = await executeGraph(graph, activation(), registry);
	expect(result.status).toBe("failed");
	expect(result.abortReason).toBe("timeout");
	expect(calls).toBe(1);
	expect(result.nodeRuns[1]).toMatchObject({ status: "aborted", error: "step timed out", diagnostics: { timedOut: true, result: { stdoutExcerpt: "partial stdout", stderrExcerpt: "actual stderr", error: "step timed out" }, attempts: [{ timedOut: true }] } });
	expect(result.usage!.stepsExecuted).toBe(1);
});

test("legacy step cap counts attempts after dispatch, never sources, gates or conditional skips", async () => {
	const calls: string[] = [];
	const registry = registryFor(async step => { calls.push(step.id); return success(); });
	const graph = graphFor([transform("skip", { when: "false" }), transform("first"), transform("second"), transform("never")], { max_steps_executed: 1 });
	graph.nodes.splice(1, 0, { id: "gate", type: "gate.if", config: { path: ["result", "message"] } });
	graph.edges[0]!.from = { nodeId: "gate", port: "true" };
	graph.edges.unshift({ id: "source-gate", from: { nodeId: "source", port: "event" }, to: { nodeId: "gate", port: "input" } });
	const result = await executeGraph(graph, activation(), registry);
	expect(calls).toEqual(["first", "second"]);
	expect(result.status).toBe("failed");
	expect(result.abortReason).toBe("budget");
	expect(result.error).toContain("max_steps_executed");
	expect(result.usage!.stepsExecuted).toBe(2);
	expect(result.nodeRuns.find(record => record.nodeId === "skip")!.status).toBe("skipped");
	expect(result.nodeRuns.find(record => record.nodeId === "second")!.diagnostics!.result).toMatchObject({ status: "success" });
	expect(output(result, "second", "completed")).toBeUndefined();
});

for (const [budget, usage] of [
	[{ max_llm_tokens_input: 2 }, { llmTokensIn: 3 }],
	[{ max_llm_tokens_output: 2 }, { llmTokensOut: 3 }],
	[{ max_llm_cost_usd: 0.001 }, { llmCostMicros: 1001 }],
] as const) {
	test(`native failed attempts enforce ${Object.keys(budget)[0]} before retry or continue`, async () => {
		let calls = 0;
		const registry = registryFor(async () => { calls++; return { ...failed(), ...usage }; });
		const graph = graphFor([transform("first", { on_failure: "retry", retry: { times: 3, backoff: "linear", max_delay_secs: 0, after_retry: "continue" } }), transform("next")], budget);
		const result = await executeGraph(graph, activation(), registry);
		expect(calls).toBe(1);
		expect(result.status).toBe("failed");
		expect(result.abortReason).toBe("budget");
		expect(result.nodeRuns[1]).toMatchObject({ status: "failed", error: "actual failure", diagnostics: { result: { status: "failed", ...usage } } });
		expect(result.usage).toMatchObject({ ...usage, stepsExecuted: 1 });
		expect(output(result, "first", "completed")).toBeUndefined();
	});
}

test("native usage equal to caps remains allowed and non-agent attempts report real zero usage", async () => {
	const graph = graphFor([transform("first"), transform("second")], { max_steps_executed: 2, max_llm_tokens_input: 0, max_llm_tokens_output: 0, max_llm_cost_usd: 0 });
	const result = await executeGraph(graph, activation(), registryFor(async () => success()));
	expect(result.status).toBe("success");
	expect(result.usage).toEqual({ stepsExecuted: 2, llmTokensIn: 0, llmTokensOut: 0, llmCostMicros: 0 });
});

test("preview dispatches no conditions or actions and consumes no legacy attempts", async () => {
	let calls = 0;
	const registry = registryFor(async () => { calls++; return success(); });
	const graph = graphFor([transform("first", { when: "throw new Error('must not evaluate')", on_failure: "retry", retry: { times: 3, backoff: "linear" } })], { max_steps_executed: 1 });
	const result = await executeGraph(graph, activation(), registry, { dryRun: true });
	expect(result.status).toBe("success");
	expect(calls).toBe(0);
	expect(result.usage!.stepsExecuted).toBe(0);
	expect(result.nodeRuns[1]!.diagnostics).toBeUndefined();
});

test("native conditions and transforms receive an unchanged webhook array payload", async () => {
	const event = [{ message: "one" }, { message: "two" }];
	const graph = graphFor([transform("first", { when: "Array.isArray(trigger) && trigger[1].message === 'two'", body: "trigger" })]);
	graph.nodes[0]!.config.eventType = "webhook";
	const result = await executeGraph(graph, { eventType: "webhook", event }, registryFor());
	expect(result.status).toBe("success");
	expect(output(result, "first").result).toEqual({ value: event });
	expect(findGraphOutput(output(result, "first"), "source")!.result).toEqual({ value: event });
});

test("each retry receives a fresh full per-attempt timeout", async () => {
	let calls = 0;
	const registry = registryFor(async (_step, _context, signal) => {
		calls++;
		await new Promise<void>(resolve => {
			const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
			const timer = setTimeout(finish, 600);
			signal.addEventListener("abort", finish, { once: true });
		});
		return calls === 1 ? failed() : success();
	});
	const graph = graphFor([transform("first", { timeout_secs: 1, on_failure: "retry", retry: { times: 2, backoff: "linear", max_delay_secs: 0 } })]);
	const result = await executeGraph(graph, activation(), registry);
	expect(result.status).toBe("success");
	expect(calls).toBe(2);
	expect(result.nodeRuns[1]!.diagnostics!.attempts).toMatchObject([{ timedOut: false }, { timedOut: false }]);
});

for (const [when, executes, type, text] of [
	["undefined", false, "undefined", "undefined"],
	["NaN", false, "number", "NaN"],
	["Infinity", true, "number", "Infinity"],
	["-Infinity", true, "number", "-Infinity"],
] as const) {
	test(`non-JSON predicate ${when} retains legacy truthiness and a tagged value`, async () => {
		let calls = 0;
		const registry = registryFor(async () => { calls++; return success(); });
		const result = await executeGraph(graphFor([transform("first", { when })]), activation(), registry);
		expect(result.status).toBe("success");
		expect(calls).toBe(executes ? 1 : 0);
		expect(result.nodeRuns[1]!.diagnostics).toMatchObject({ whenExpression: when, whenValueRepresentation: { type, text } });
		expect(result.nodeRuns[1]!.diagnostics).not.toHaveProperty("whenValue");
	});
}

test("a recovered retry still trips the legacy attempt cap after its real result is recorded", async () => {
	let calls = 0;
	const registry = registryFor(async () => ++calls === 1 ? failed() : success());
	const graph = graphFor([transform("first", { on_failure: "retry", retry: { times: 3, backoff: "linear", max_delay_secs: 0 } })], { max_steps_executed: 1 });
	const result = await executeGraph(graph, activation(), registry);
	expect(calls).toBe(2);
	expect(result.status).toBe("failed");
	expect(result.abortReason).toBe("budget");
	expect(result.usage!.stepsExecuted).toBe(2);
	expect(result.nodeRuns[1]!.diagnostics!.attempts).toMatchObject([{ result: { status: "failed" } }, { result: { status: "success" } }]);
	expect(output(result, "first")).toBeUndefined();
});

test("completion chains keep all prior context and original envelopes without exponential JSON duplication", async () => {
	const sizes: number[] = [];
	for (const count of [4, 8]) {
		const steps = Array.from({ length: count }, (_, index) => transform(`step_${index}`));
		const event = activation();
		const registry = registryFor(async (step, context) => {
			const index = Number(step.id.slice(5));
			expect(Object.keys(context.steps)).toEqual(steps.slice(0, index).map(previous => previous.id));
			for (const previous of steps.slice(0, index)) expect(context.steps[previous.id]!.json).toEqual({ id: previous.id });
			return success({ id: step.id });
		});
		const result = await executeGraph(graphFor(steps), event, registry);
		expect(result.status).toBe("success");
		for (const step of steps) {
			const completed = output(result, step.id, "completed");
			expect(completed.inputs).toEqual([output(result, step.id)]);
			expect(findGraphOutput(completed, "source")!.result).toBe(event.event);
			for (const previous of steps.slice(0, steps.indexOf(step) + 1)) expect(findGraphOutput(completed, previous.id, "result")).toBe(output(result, previous.id));
		}
		sizes.push(JSON.stringify(output(result, steps[count - 1]!.id, "completed")).length);
	}
	expect(sizes[1]!).toBeLessThan(sizes[0]! * 3);
});
