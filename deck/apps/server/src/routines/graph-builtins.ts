import { graphBuiltinNodeTypes, type GraphEmission, type GraphValue, type RoutineGraph } from "@npi-deck/protocol";
import type { GraphNodeContext, GraphNodeImplementation } from "./graph-runner.ts";

function selected({ node, inputs }: GraphNodeContext): GraphValue {
	let value: unknown = inputs[0]!.output;
	for (const key of node.config.path as (string | number)[]) {
		if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Input path has no own property ${String(key)}`);
		value = (value as Record<string | number, unknown>)[key];
	}
	return value as GraphValue;
}
/** Typed structural JSON equality. Object key order does not affect membership. */
function equal(left: GraphValue, right: GraphValue): boolean {
	if (left === right) return true;
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal((left as Record<string, GraphValue>)[key]!, (right as Record<string, GraphValue>)[key]!));
}
function compare(left: GraphValue, right: GraphValue, operator: GraphValue | undefined): boolean {
	if (operator === "eq") return equal(left, right);
	if (operator === "ne") return !equal(left, right);
	if (!((typeof left === "number" && typeof right === "number") || (typeof left === "string" && typeof right === "string"))) throw new Error("Ordered comparison requires two numbers or two strings; values are never coerced");
	switch (operator) {
		case "lt": return left < right;
		case "lte": return left <= right;
		case "gt": return left > right;
		case "gte": return left >= right;
		default: throw new Error("Unknown comparison operator");
	}
}
async function execute(context: GraphNodeContext): Promise<GraphEmission[]> {
	const { node } = context;
	if (node.type === "iteration.input") return [{ port: "item", value: context.activation.event }];
	if (node.type === "operation.arithmetic") {
		const left = context.inputs.find(input => input.port === "left")!.output.result.value as number;
		const right = context.inputs.find(input => input.port === "right")!.output.result.value as number;
		let value: number;
		switch (node.config.operator) {
			case "add": value = left + right; break;
			case "subtract": value = left - right; break;
			case "multiply": value = left * right; break;
			case "divide": if (right === 0) throw new Error("Division by zero"); value = left / right; break;
			case "remainder": if (right === 0) throw new Error("Remainder by zero"); value = left % right; break;
			case "power": value = left ** right; break;
			default: throw new Error("Unknown arithmetic operator");
		}
		if (!Number.isFinite(value)) throw new Error("Arithmetic result must be finite");
		return [{ port: "value", value }];
	}
	const value = selected(context);
	switch (node.type) {
		case "gate.if": return [{ port: value ? "true" : "false", value }];
		case "gate.compare": return [{ port: compare(value, node.config.right!, node.config.operator) ? "true" : "false", value }];
		case "gate.member": return [{ port: (node.config.values as GraphValue[]).some(item => equal(value, item)) ? "true" : "false", value }];
		case "operation.number": if (typeof value !== "number") throw new Error("Read number requires a numeric value; strings and booleans are not coerced"); return [{ port: "value", value }];
		case "operation.pick": return [{ port: "value", value }];
		case "iteration.each": {
			if (!Array.isArray(value)) throw new Error("Iteration requires an array");
			if (value.length > (node.config.maxIterations as number)) throw new Error(`Iteration needs ${value.length} passes, exceeding maxIterations ${node.config.maxIterations}`);
			await context.iterate!(node.config.body as unknown as RoutineGraph, value);
			return [{ port: "completed", value: { count: value.length, completed: true } }];
		}
		default: throw new Error(`Unknown graph builtin ${node.type}`);
	}
}
export const graphBuiltins: GraphNodeImplementation[] = graphBuiltinNodeTypes.map(definition => ({ definition, execute }));
