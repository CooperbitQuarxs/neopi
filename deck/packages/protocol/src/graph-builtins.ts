import type { GraphNodeType, GraphObject } from "./graph";

export const MAX_GRAPH_ITERATIONS = 100;
export const MAX_GRAPH_ITERATION_DEPTH = 4;
const path: GraphObject = { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0 }] }, maxItems: 64 };
function config(properties: GraphObject, required: string[] = []): GraphObject { return { type: "object", properties, required, additionalProperties: false }; }
const input = [{ id: "input", type: "object" as const }];
const branches = [{ id: "true", type: "object" as const }, { id: "false", type: "object" as const }];
export const graphBuiltinNodeTypes: readonly GraphNodeType[] = [
	{ type: "gate.if", label: "If value", kind: "gate", inputs: input, outputs: branches, configSchema: config({ path }, ["path"]) },
	{ type: "gate.compare", label: "Compare values", kind: "gate", inputs: input, outputs: branches, configSchema: config({ path, operator: { enum: ["eq", "ne", "lt", "lte", "gt", "gte"] }, right: {} }, ["path", "operator", "right"]) },
	{ type: "gate.member", label: "Set membership", kind: "gate", inputs: input, outputs: branches, configSchema: config({ path, values: { type: "array" } }, ["path", "values"]) },
	{ type: "operation.pick", label: "Read value", kind: "operation", inputs: input, outputs: [{ id: "value", type: "object" }], configSchema: config({ path }, ["path"]) },
	{ type: "operation.number", label: "Read number", kind: "operation", inputs: input, outputs: [{ id: "value", type: "number" }], configSchema: config({ path }, ["path"]) },
	{ type: "operation.arithmetic", label: "Arithmetic", kind: "operation", inputs: [{ id: "left", type: "number" }, { id: "right", type: "number" }], outputs: [{ id: "value", type: "number" }], configSchema: config({ operator: { enum: ["add", "subtract", "multiply", "divide", "remainder", "power"] } }, ["operator"]) },
	{ type: "iteration.each", label: "For each item", kind: "operation", inputs: input, outputs: [{ id: "completed", type: "object" }], configSchema: config({ path, maxIterations: { type: "integer", minimum: 1, maximum: MAX_GRAPH_ITERATIONS }, body: { type: "object" } }, ["path", "maxIterations", "body"]) },
	{ type: "iteration.input", label: "Iteration item", kind: "event", inputs: [], outputs: [{ id: "item", type: "object" }], configSchema: config({ eventType: { const: "iteration" } }, ["eventType"]) },
];
