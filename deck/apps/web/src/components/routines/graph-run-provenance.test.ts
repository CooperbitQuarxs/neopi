import { describe, expect, test } from "bun:test";
import type { GraphNodeRun, GraphOutput, GraphRunRecord, GraphValue, RoutineGraph } from "@npi-deck/protocol";
import { derivedInputEdges, iterationLabel, nodeOutcome, occurrenceKey, producingOccurrence, runOccurrences, snapshotNodeTitle, valueDescription } from "./graph-run-provenance";

function record(nodeId: string, outputs: GraphOutput[] = [], inputs: GraphOutput[] = [], inputPorts: string[] = []): GraphNodeRun {
	return { nodeId, type: "removed.registration", status: "success", endedAt: "2026-10-22T00:00:00Z", inputs, inputPorts, outputs };
}
function trace(graph: RoutineGraph, nodeRuns: GraphNodeRun[]): GraphRunRecord {
	return { id: "historical", routineId: "routine", startedAt: "2026-10-22T00:00:00Z", endedAt: "2026-10-22T00:00:01Z", graph, nodeRuns, outputs: nodeRuns.flatMap(run => run.outputs), status: "success", activation: { eventType: "manual", event: { original: true } } };
}

export const typedValues: GraphValue[] = [false, 0, "", null, [], {}, true, "truthy but not true", { value: "an object property", other: [false, 0] }];

describe("stored graph provenance", () => {
	test("retains JSON value types and empty values without truthiness conversion", () => {
		expect(typedValues.map(valueDescription)).toEqual([
			{ type: "boolean", text: "false" }, { type: "number", text: "0" }, { type: "string", text: '\"\"' },
			{ type: "null", text: "null" }, { type: "array", text: "[]" }, { type: "object", text: "{}" },
			{ type: "boolean", text: "true" }, { type: "string", text: '\"truthy but not true\"' }, { type: "object", text: "2 properties" },
		]);
	});

	test("keys retain equal outputs and repeated node IDs across passes", () => {
		const body: RoutineGraph = { version: 2, nodes: [{ id: "same", type: "iteration.input", config: {} }], edges: [] };
		const iterator = record("each");
		iterator.passes = [0, 1].map(index => {
			const output: GraphOutput = { nodeId: "same", port: "item", result: { item: false }, inputs: [], iteration: [{ nodeId: "each", index }] };
			return { index, status: "success", nodeRuns: [{ ...record("same", [output, output]), iteration: output.iteration }], outputs: [output, output] };
		});
		const saved = JSON.parse(JSON.stringify(trace({ version: 2, nodes: [{ id: "each", type: "iteration.each", config: { body: body as unknown as GraphValue } }], edges: [] }, [iterator]))) as GraphRunRecord;
		const occurrences = runOccurrences(saved);
		expect(occurrences).toHaveLength(3);
		expect(new Set(occurrences.map(item => item.key)).size).toBe(3);
		expect(occurrences.slice(1).map(item => iterationLabel(item.run.iteration))).toEqual(["each[0]", "each[1]"]);
		const repeated = saved.nodeRuns[0]!.passes![1]!.outputs;
		expect(producingOccurrence(occurrences, repeated[0]!)?.key).toBe("historical/nodes/0/passes/1/nodes/0");
		expect(occurrenceKey("pass", "outputs", 0)).not.toBe(occurrenceKey("pass", "outputs", 1));
	});

	test("derives duplicate incoming edges in snapshot and emission order", () => {
		const one: GraphOutput = { nodeId: "source", port: "items", result: { value: 0 }, inputs: [] };
		const two: GraphOutput = { ...one, result: { value: false } };
		const source = record("source", [one, two]);
		const target = record("target", [], [one, two, one, two], ["left", "left", "right", "right"]);
		const saved = trace({ version: 2, nodes: [], edges: [
			{ id: "first", from: { nodeId: "source", port: "items" }, to: { nodeId: "target", port: "left" } },
			{ id: "second", from: { nodeId: "source", port: "items" }, to: { nodeId: "target", port: "right" } },
		] }, [source, target]);
		const occurrence = runOccurrences(saved)[1]!;
		expect(derivedInputEdges(occurrence).map(edge => edge?.id)).toEqual(["first", "first", "second", "second"]);
		target.inputPorts[0] = "unknown";
		expect(derivedInputEdges(occurrence)).toEqual([undefined, undefined, undefined, undefined]);
	});

	test("leaves iteration parent associations unavailable rather than guessing", () => {
		const input: GraphOutput = { nodeId: "outer", port: "event", result: {}, inputs: [] };
		const node = record("item", [], [input], ["parent"]);
		expect(derivedInputEdges({ key: "item", graph: { version: 2, nodes: [], edges: [] }, siblings: [node], run: node })).toEqual([undefined]);
	});

	test("distinguishes successful zero emissions, skipped, failed and aborted", () => {
		const node = record("node");
		expect(nodeOutcome(node)).toBe("Succeeded without emitting an output");
		expect(nodeOutcome({ ...node, status: "skipped" })).toContain("not invoked");
		expect(nodeOutcome({ ...node, status: "failed" })).toBe("Failed");
		expect(nodeOutcome({ ...node, status: "aborted" })).toBe("Aborted");
	});

	test("reads labels from the snapshot without a current catalogue", () => {
		expect(snapshotNodeTitle({ id: "old", type: "deleted.type", config: { name: "Original source", value: 0 } }, "old")).toBe("Original source");
		expect(snapshotNodeTitle({ id: "old", type: "deleted.type", config: {} }, "old")).toBe("deleted.type");
	});
});
