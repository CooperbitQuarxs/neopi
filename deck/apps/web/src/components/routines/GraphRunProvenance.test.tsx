import { afterEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { GraphNodeRun, GraphOutput, GraphRunRecord, GraphValue, RoutineGraph } from "@npi-deck/protocol";
import { GraphRunProvenance, GraphValueTree } from "./GraphRunProvenance";

let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
function expandAll(): void {
	for (;;) {
		const button = renderer!.root.findAllByType("button").find(candidate => candidate.props["aria-expanded"] === false);
		if (!button) return;
		act(() => button.props.onClick());
	}
}
function text(): string { return JSON.stringify(renderer!.toJSON()); }
function node(nodeId: string, outputs: GraphOutput[], inputs: GraphOutput[] = []): GraphNodeRun {
	return { nodeId, type: "old.registration", status: "success", endedAt: "2026-10-22T00:00:01Z", inputs, inputPorts: inputs.map(() => "input"), outputs };
}
function savedTrace(graph: RoutineGraph, nodeRuns: GraphNodeRun[]): GraphRunRecord {
	return JSON.parse(JSON.stringify({ id: "old-run", routineId: "routine", startedAt: "2026-10-22T00:00:00Z", endedAt: "2026-10-22T00:00:01Z", graph, nodeRuns, outputs: nodeRuns.flatMap(run => run.outputs), status: "success", activation: { eventType: "manual", event: { originalEvent: "source payload" } } })) as GraphRunRecord;
}

describe("GraphRunProvenance", () => {
	test("renders typed falsy/empty values and keeps an object's value property", () => {
		act(() => { renderer = create(<GraphValueTree path="result" label="Result" value={{ value: false, zero: 0, emptyString: "", nothing: null, emptyArray: [], emptyObject: {}, literalTrue: true, truthyString: "not a boolean" }} initiallyOpen />); });
		const values = renderer!.root.findAll(candidate => candidate.props.className === "graph-provenance-value");
		expect(values).toHaveLength(8);
		expect(text()).toContain("emptyString");
		expect(text()).toContain("boolean");
		expect(text()).toContain("number");
		expect(text()).toContain("null");
		expect(text()).toContain("[]");
		expect(text()).toContain("{}");
		expect(text()).toContain("not a boolean");
	});

	test("expands ordered ancestry to the source and original activation using stored labels", () => {
		const event: GraphOutput = { nodeId: "source", port: "event", result: { sourceProperty: 0 }, inputs: [] };
		const gate: GraphOutput = { nodeId: "gate", port: "false", result: { value: "truthy non-true" }, inputs: [event] };
		const graph: RoutineGraph = { version: 2, nodes: [{ id: "source", type: "removed.source", config: { name: "Original source" } }, { id: "gate", type: "removed.gate", config: { name: "Original gate", preserved: false } }], edges: [{ id: "old-edge", from: { nodeId: "source", port: "event" }, to: { nodeId: "gate", port: "input" } }] };
		act(() => { renderer = create(<GraphRunProvenance trace={savedTrace(graph, [node("source", [event]), node("gate", [gate], [event])])} nodeId="gate" />); });
		expandAll();
		for (const value of ["Original source", "Original gate", "removed.gate", "preserved", "truthy non-true", "sourceProperty", "Original activation", "source payload", "old-edge", "derived from snapshot edge and emission order", "consuming port"]) expect(text()).toContain(value);
		expect(renderer!.root.findAllByType("pre")).toHaveLength(0);
	});

	test("retains identical output occurrences in every pass with unique tree paths", () => {
		const body: RoutineGraph = { version: 2, nodes: [{ id: "item", type: "iteration.input", config: {} }], edges: [] };
		const each = node("each", []);
		each.passes = [0, 1].map(index => {
			const output: GraphOutput = { nodeId: "item", port: "item", result: { item: false }, inputs: [], iteration: [{ nodeId: "each", index }] };
			return { index, status: "success", nodeRuns: [{ ...node("item", [output, output]), iteration: output.iteration }], outputs: [output, output] };
		});
		const trace = savedTrace({ version: 2, nodes: [{ id: "each", type: "iteration.each", config: { body: body as unknown as GraphValue } }], edges: [] }, [each]);
		act(() => { renderer = create(<GraphRunProvenance trace={trace} nodeId="item" />); });
		expandAll();
		const paths = renderer!.root.findAll(candidate => typeof candidate.props["data-occurrence"] === "string").map(candidate => candidate.props["data-occurrence"] as string);
		expect(new Set(paths).size).toBe(paths.length);
		for (const pass of [0, 1]) for (const output of [0, 1]) expect(paths).toContain(`old-run/nodes/0/passes/${pass}/nodes/0/outputs/${output}`);
		expect(text()).toContain("each[0]");
		expect(text()).toContain("each[1]");
	});

	test("shows successful zero output and inactive/failure/abort separately", () => {
		const runs = [node("empty", []), { ...node("inactive", []), status: "skipped" as const }, { ...node("failed", []), status: "failed" as const, error: "Stored failure" }, { ...node("aborted", []), status: "aborted" as const, error: "Stored cancellation" }];
		act(() => { renderer = create(<GraphRunProvenance trace={savedTrace({ version: 2, nodes: [], edges: [] }, runs)} />); });
		expandAll();
		for (const value of ["Succeeded without emitting an output", "Successful execution with zero outputs", "not invoked", "Stored failure", "Stored cancellation", "Failed", "Aborted"]) expect(text()).toContain(value);
	});
});
