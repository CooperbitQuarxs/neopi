import type { GraphNodeType, GraphObject, GraphValue } from "@npi-deck/protocol";

export function graphObject(value: unknown): GraphObject | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as GraphObject : undefined;
}
export function schemaProperties(schema: GraphObject): Record<string, GraphObject> {
	return Object.fromEntries(Object.entries(graphObject(schema.properties) ?? {}).map(([key, value]) => [key, graphObject(value) ?? {}]));
}
export function schemaChoices(schema: GraphObject): GraphObject[] {
	const choices = schema.oneOf ?? schema.anyOf;
	return Array.isArray(choices) ? choices.map(graphObject).filter((value): value is GraphObject => value !== undefined) : [];
}
export function valueKind(value: GraphValue): string {
	return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}
export function schemaForValue(schema: GraphObject, value: GraphValue): GraphObject {
	const choices = schemaChoices(schema);
	const match = choices.find(choice => {
		if (choice.const !== undefined) return JSON.stringify(choice.const) === JSON.stringify(value);
		if (Array.isArray(choice.enum)) return choice.enum.some(item => JSON.stringify(item) === JSON.stringify(value));
		if (choice.type && choice.type !== valueKind(value) && !(choice.type === "integer" && typeof value === "number" && Number.isInteger(value))) return false;
		const record = graphObject(value);
		return Object.entries(schemaProperties(choice)).every(([key, field]) => field.const === undefined || record?.[key] === field.const);
	});
	if (!match) return schema;
	const { oneOf: _oneOf, anyOf: _anyOf, ...base } = schema;
	return { ...base, ...match };
}

export function resolveConfigSchema(schema: GraphObject, root: GraphObject): GraphObject {
	if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
	let value: GraphValue = root;
	for (const key of schema.$ref.slice(2).split("/").map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"))) {
		const next: GraphValue | undefined = graphObject(value)?.[key];
		if (next === undefined) return schema;
		value = next;
	}
	return graphObject(value) ?? schema;
}

/** Seed only schema-required fields. Optional values are never silently added. */
export function schemaDefault(schema: GraphObject, root: GraphObject = schema, depth = 0): GraphValue {
	if (depth > 32) return null;
	schema = resolveConfigSchema(schema, root);
	if (schema.default !== undefined) return structuredClone(schema.default);
	if (schema.const !== undefined) return structuredClone(schema.const);
	if (Array.isArray(schema.enum) && schema.enum.length) return structuredClone(schema.enum[0]!);
	const choice = schemaChoices(schema)[0];
	if (choice) return schemaDefault(choice, root, depth + 1);
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	if (type === "object" || schema.properties) {
		const properties = schemaProperties(schema);
		return Object.fromEntries((Array.isArray(schema.required) ? schema.required : []).filter((key): key is string => typeof key === "string").map(key => [key, schemaDefault(properties[key] ?? {}, root, depth + 1)]));
	}
	if (type === "array") return [];
	if (type === "boolean") return false;
	if (type === "integer" || type === "number") return typeof schema.minimum === "number" ? schema.minimum : 0;
	if (type === "null") return null;
	return "";
}

const text: GraphObject = { type: "string" };
const strings: GraphObject = { type: "array", items: text };
const object = (properties: GraphObject, required: string[] = []): GraphObject => ({ type: "object", properties, required, additionalProperties: false });

/** Field descriptions for the delivered action request contract, not a node catalogue. */
function actionRequestSchema(type: string): GraphObject | undefined {
	if (type === "action.create-card") return object({
		title: text, body: text, stateId: text, cwd: { type: ["string", "null"] }, properties: { type: "object" },
		orderInState: { type: "integer" }, archived: { type: "boolean" },
	}, ["title"]);
	if (type === "action.send-message") return object({ destination: text, payload: object({
		kind: { enum: ["routine_failed", "task_shipped", "auth_fallback"] },
		level: { enum: ["info", "warn", "error", "critical"] }, title: text, body: text,
		sound: { type: "boolean" }, source: text, actionUrl: text,
	}, ["kind", "level", "title"]) }, ["destination", "payload"]);
	if (type === "action.file-issue") return object({
		host: { type: "string", default: "github.com" }, owner: text, repo: text, title: text, body: text,
		labels: strings, assignees: strings, milestone: { type: "integer" },
		attribution: object({ agent: text, onBehalfOf: { const: "PsychedelicShayna" } }, ["agent", "onBehalfOf"]),
	}, ["host", "owner", "repo", "title", "body"]);
	return undefined;
}

export function configFormSchema(definition: GraphNodeType): GraphObject {
	const schema = definition.configSchema ?? { type: "object" };
	const request = actionRequestSchema(definition.type);
	const delivered = schemaProperties(schema).request;
	if (!request || !delivered) return schema;
	const requestForm = { ...request, ...delivered, properties: { ...(graphObject(request.properties) ?? {}), ...(graphObject(delivered.properties) ?? {}) }, required: delivered.required ?? request.required ?? [] };
	return { ...schema, properties: { ...(graphObject(schema.properties) ?? {}), request: requestForm } };
}

export function newNodeConfig(definition: GraphNodeType, catalogue: readonly GraphNodeType[] = []): GraphObject {
	const config = graphObject(schemaDefault(configFormSchema(definition))) ?? {};
	if (definition.type === "event.source" && config.eventType === "") config.eventType = "manual";
	if (definition.type === "iteration.each") {
		const source = catalogue.find(type => type.type === "iteration.input");
		if (source) config.body = { version: 2, nodes: [{ id: "item", type: source.type, config: newNodeConfig(source) }], edges: [] };
	}
	return config;
}
