import { describe, expect, test } from "bun:test";

import type { RoutineSpec, ValidationError } from "@npi-deck/protocol";

import { fieldErrorsForSpec, summarizeRoutineValidationErrors, validateStepId } from "./routine-validation";

const spec: RoutineSpec = {
	name: "daily-briefing",
	trigger: [{ manual: {} }],
	steps: [
		{ id: "should_run", type: "transform", body: "return true" },
		{ id: "Agent Bad", type: "agent", prompt: "hello" },
	],
};

describe("routine validation summaries", () => {
	test("validates step ids with the same pattern as the schema", () => {
		expect(validateStepId("agent_1")).toBeUndefined();
		expect(validateStepId("Agent Bad")).toContain("lowercase");
		expect(validateStepId("1_agent")).toContain("start with a letter");
	});

	test("collapses Ajv oneOf noise to the relevant invalid id", () => {
		const errors: ValidationError[] = [
			{
				path: "/steps/1/id",
				keyword: "pattern",
				message: 'must match pattern "^[a-z][a-z0-9_]*$"',
				params: { pattern: "^[a-z][a-z0-9_]*$" },
			},
			{
				path: "/steps/1",
				keyword: "required",
				message: "must have required property 'command'",
				params: { missingProperty: "command" },
			},
			{
				path: "/steps/1/type",
				keyword: "const",
				message: "must be equal to constant",
				params: { allowedValue: "run" },
			},
			{
				path: "/steps/1",
				keyword: "oneOf",
				message: "must match exactly one schema in oneOf",
				params: { passingSchemas: null },
			},
		];

		expect(summarizeRoutineValidationErrors(errors, spec)).toEqual([
			{
				path: "/steps/1/id",
				message: "Step 2 (agent) id: use lowercase letters, numbers, and underscores; start with a letter",
			},
		]);
	});
});

describe("fieldErrorsForSpec", () => {
	test("groups schema errors by step id and field, ignoring oneOf and type noise", () => {
		const errors: ValidationError[] = [
			{ path: "/steps/1/id", keyword: "pattern", message: 'must match pattern "^[a-z][a-z0-9_]*$"', params: {} },
			{ path: "/steps/1/prompt", keyword: "minLength", message: "must NOT have fewer than 1 characters", params: {} },
			{ path: "/steps/1", keyword: "required", message: "must have required property 'command'", params: { missingProperty: "command" } },
			{ path: "/steps/1/type", keyword: "const", message: "must be equal to constant", params: {} },
			{ path: "/steps/1", keyword: "oneOf", message: "must match exactly one schema in oneOf", params: {} },
			{ path: "/trigger", keyword: "minItems", message: "must NOT have fewer than 1 items", params: {} },
		];
		const grouped = fieldErrorsForSpec(errors, spec);
		expect(grouped.steps.get("Agent Bad")).toEqual({
			id: "Use lowercase letters, numbers and underscores, starting with a letter.",
			prompt: "Required.",
		});
		expect(grouped.steps.has("should_run")).toBe(false);
		expect(grouped.top).toEqual({ trigger: "Add at least one." });
		expect(grouped.count).toBe(3);
	});

	test("reports a present-but-empty required field the schema lets through", () => {
		const empties: RoutineSpec = {
			name: "x",
			trigger: [{ manual: {} }],
			steps: [
				{ id: "fetch", type: "http", method: "GET", url: "   " },
				{ id: "ok", type: "run", command: "echo hi" },
			],
		};
		const grouped = fieldErrorsForSpec([], empties);
		expect(grouped.steps.get("fetch")).toEqual({ url: "Required." });
		expect(grouped.steps.has("ok")).toBe(false);
		expect(grouped.count).toBe(1);
	});
});
