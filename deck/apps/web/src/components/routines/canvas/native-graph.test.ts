import { describe, expect, test } from "bun:test";
import { validateRoutineGraph, type GraphNodeType, type GraphObject, type RoutineGraph } from "@npi-deck/protocol";
import { connectGraph, removeGraphEdges } from "./graph-connect";
import { configFormSchema, newNodeConfig, schemaDefault, schemaForValue } from "./graph-config";
import { graphNodePosition, removeGraphNodes } from "./graph-types";

const catalogue: GraphNodeType[] = [
	{ type: "source", label: "Source", kind: "event", inputs: [], outputs: [{ id: "event", type: "object" }] },
	{ type: "number", label: "Number", kind: "operation", inputs: [{ id: "input", type: "object" }], outputs: [{ id: "value", type: "number" }] },
	{ type: "gate", label: "Gate", kind: "gate", inputs: [{ id: "input", type: "object" }], outputs: [{ id: "true", type: "object" }, { id: "false", type: "object" }] },
	{ type: "sum", label: "Add", kind: "operation", inputs: [{ id: "left", type: "number" }, { id: "right", type: "number" }], outputs: [{ id: "value", type: "number" }] },
	{ type: "sink", label: "Sink", kind: "action", inputs: [{ id: "in", type: "object", multiple: true }], outputs: [] },
	{ type: "optional", label: "Optional", kind: "action", inputs: [{ id: "in", type: "number", required: false }], outputs: [] },
	{ type: "many", label: "Many", kind: "operation", inputs: [{ id: "input", type: "object" }], outputs: [{ id: "out", type: "number", multiple: true }] },
];
function graph(): RoutineGraph {
	return { version: 2, nodes: [
		{ id: "event", type: "source", config: { eventType: "manual" } },
		{ id: "number", type: "number", config: {} },
		{ id: "sum", type: "sum", config: {} },
		{ id: "sink", type: "sink", config: {} },
	], edges: [] };
}
function connect(value: RoutineGraph, source: string, sourceHandle: string, target: string, targetHandle: string, id = "edge-1") {
	return connectGraph(value, catalogue, { source, sourceHandle, target, targetHandle }, id);
}

describe("native graph connection validation", () => {
	test("completes drafts without unrelated required-input or reachability errors blocking wiring", () => {
		const draft = graph();
		expect(validateRoutineGraph(draft, catalogue).valid).toBe(false);
		const first = connect(draft, "event", "event", "number", "input", "native-id");
		expect(first.errors).toEqual([]);
		const second = connect(first.graph, "number", "value", "sum", "left", "second-id");
		expect(second.errors).toEqual([]);
		expect(second.graph.edges.map(edge => edge.id)).toEqual(["native-id", "second-id"]);
		expect(second.graph.edges[1]!.from.port).toBe("value");
		expect(second.graph.edges[1]!.to.port).toBe("left");
	});
	test("rejects unknown endpoints, reversed handles, types, duplicate ids and cardinality", () => {
		const draft = graph();
		for (const [from, output, to, input] of [
			["missing", "event", "number", "input"], ["event", "input", "number", "input"],
			["event", "event", "number", "value"], ["event", "event", "sum", "left"],
		] as const) expect(connect(draft, from, output, to, input).errors.length).toBeGreaterThan(0);
		const wired = connect(draft, "event", "event", "number", "input").graph;
		expect(connect(wired, "event", "event", "number", "input", "second").errors.some(error => error.keyword === "multiple")).toBe(true);
		expect(connect(wired, "number", "value", "sink", "in").errors.some(error => error.keyword === "unique")).toBe(true);
	});
	test("rejects cycles while accepting universal-object and multiple-input sinks", () => {
		const draft = graph();
		const wired = connect(draft, "event", "event", "number", "input").graph;
		const sink = connect(wired, "number", "value", "sink", "in", "number-sink");
		expect(sink.errors).toEqual([]);
		expect(connect(sink.graph, "event", "event", "sink", "in", "event-sink").errors).toEqual([]);
		const withSum = connect(wired, "number", "value", "sum", "left", "number-sum").graph;
		expect(connect(withSum, "sum", "value", "number", "input", "loop").errors.some(error => error.keyword === "cycle")).toBe(true);
	});
	test("rejects a multiple-emission output for a single input and accepts it for multiple inputs", () => {
		const draft = graph(); draft.nodes.push({ id: "many", type: "many", config: {} });
		expect(connect(draft, "many", "out", "sum", "left").errors.some(error => error.keyword === "multiple")).toBe(true);
		expect(connect(draft, "many", "out", "sink", "in").errors).toEqual([]);
	});
	test("keeps distinct true and false ports and edge emission order", () => {
		const draft = graph(); draft.nodes.push({ id: "gate", type: "gate", config: {} });
		const truth = connect(draft, "gate", "true", "sink", "in", "truth").graph;
		const falsehood = connect(truth, "gate", "false", "sink", "in", "falsehood").graph;
		expect(falsehood.edges.map(edge => edge.from.port)).toEqual(["true", "false"]);
	});
	test("accepts an optional target without requiring unrelated optional ports", () => {
		const draft = graph(); draft.nodes.push({ id: "optional", type: "optional", config: {} });
		expect(connect(draft, "number", "value", "optional", "in").errors).toEqual([]);
	});
});

describe("native graph editing", () => {
	test("deleting the final edge retains an empty native edge array without inferred wiring", () => {
		const draft = connect(graph(), "event", "event", "number", "input", "keep-id").graph;
		const empty = removeGraphEdges(draft, new Set(["keep-id"]));
		expect(empty.edges).toEqual([]);
		expect(empty.nodes).toBe(draft.nodes);
		expect(removeGraphEdges(empty, new Set(["unknown"]))).toBe(empty);
	});
	test("node deletion removes only incident edges and its layout", () => {
		const first = connect(graph(), "event", "event", "number", "input", "one").graph;
		const draft = connect(first, "event", "event", "sink", "in", "two").graph;
		draft.layout = { nodes: { event: { x: 10, y: 20 }, number: { x: 40, y: 50 } } };
		const next = removeGraphNodes(draft, new Set(["number"]));
		expect(next.edges.map(edge => edge.id)).toEqual(["two"]);
		expect(next.layout?.nodes).toEqual({ event: { x: 10, y: 20 } });
		expect(graphNodePosition(draft, "event", 100)).toEqual({ x: 10, y: 20 });
		expect(removeGraphNodes(draft, new Set(["unknown"]))).toBe(draft);
	});
});

describe("typed configuration defaults", () => {
	test("retains every nested JSON value without string conversion", () => {
		const value = { false: false, zero: 0, empty: "", nil: null, array: [true, 2, { name: "nested" }], object: {} };
		expect(schemaDefault({ default: value })).toEqual(value);
		expect(schemaDefault({ default: value })).not.toBe(value);
	});
	test("seeds constants and required typed fields without adding optional values", () => {
		const schema: GraphObject = { type: "object", required: ["eventType", "count", "flags"], properties: { eventType: { const: "inbox.card_added" }, count: { type: "integer", minimum: 1 }, flags: { type: "array" }, optional: { type: "boolean" } } };
		expect(schemaDefault(schema)).toEqual({ eventType: "inbox.card_added", count: 1, flags: [] });
		expect(newNodeConfig({ ...catalogue[0]!, configSchema: schema })).toEqual({ eventType: "inbox.card_added", count: 1, flags: [] });
	});
	test("selects an object schema variant by its stored discriminator", () => {
		const schema: GraphObject = { oneOf: [{ type: "object", properties: { type: { const: "first" } } }, { type: "object", properties: { type: { const: "second" }, enabled: { type: "boolean" } } }] };
		expect((schemaForValue(schema, { type: "second", enabled: false }).properties as GraphObject).enabled).toEqual({ type: "boolean" });
	});
	test("uses the delivered action registration but adds ordinary request fields", () => {
		const definition: GraphNodeType = { type: "action.create-card", label: "Create card", kind: "action", inputs: [], outputs: [], configSchema: { type: "object", required: ["request"], properties: { request: { type: "object" } }, additionalProperties: false } };
		expect(newNodeConfig(definition)).toEqual({ request: { title: "" } });
		expect(configFormSchema(definition).additionalProperties).toBe(false);
		expect(definition.configSchema?.properties).toEqual({ request: { type: "object" } });
	});
	test("resolves nested local schema references when seeding typed objects", () => {
		const schema: GraphObject = {
			type: "object", required: ["nested"], properties: { nested: { $ref: "#/$defs/nested" } },
			$defs: { nested: { type: "object", required: ["enabled", "count"], properties: { enabled: { type: "boolean" }, count: { type: "integer", minimum: 2 } } } },
		};
		expect(schemaDefault(schema)).toEqual({ nested: { enabled: false, count: 2 } });
	});
	test("keeps more specific delivered action fields authoritative", () => {
		const definition: GraphNodeType = {
			type: "action.create-card", label: "Create card", kind: "action", inputs: [], outputs: [],
			configSchema: { type: "object", properties: { request: { type: "object", required: ["title", "archived"], properties: { title: { type: "string", minLength: 3 }, archived: { const: true } } } } },
		};
		const request = (configFormSchema(definition).properties as GraphObject).request as GraphObject;
		expect(request.required).toEqual(["title", "archived"]);
		expect((request.properties as GraphObject).archived).toEqual({ const: true });
		expect((request.properties as GraphObject).title).toEqual({ type: "string", minLength: 3 });
	});
});
