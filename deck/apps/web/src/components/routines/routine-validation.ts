import type { RoutineSpec, RoutineStep, ValidationError } from "@npi-deck/protocol";

export const STEP_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const STEP_ID_REQUIREMENT = "use lowercase letters, numbers, and underscores; start with a letter";

export function validateStepId(id: string): string | undefined {
	if (id.length === 0) return "required";
	return STEP_ID_PATTERN.test(id) ? undefined : STEP_ID_REQUIREMENT;
}

export interface RoutineValidationMessage {
	path: string;
	message: string;
}

const REQUIRED_BY_TYPE: Record<RoutineStep["type"], readonly string[]> = {
	run: ["id", "type", "command"],
	agent: ["id", "type", "prompt"],
	write: ["id", "type", "path", "content"],
	http: ["id", "type", "method", "url"],
	deck: ["id", "type", "action"],
	mcp: ["id", "type", "server", "tool"],
	transform: ["id", "type", "body"],
	wait: ["id", "type", "duration_secs"],
	set_state: ["id", "type", "state"],
};

export function summarizeRoutineValidationErrors(
	errors: readonly ValidationError[] | undefined,
	spec: RoutineSpec,
): RoutineValidationMessage[] {
	if (!errors || errors.length === 0) return [];

	const messages: RoutineValidationMessage[] = [];
	const seen = new Set<string>();
	for (const error of errors) {
		const message = summarizeValidationError(error, spec);
		if (!message) continue;
		const key = `${message.path}\u0000${message.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		messages.push(message);
	}

	return messages.length > 0 ? messages : [{ path: "/", message: "Spec is invalid" }];
}

function summarizeValidationError(error: ValidationError, spec: RoutineSpec): RoutineValidationMessage | undefined {
	if (error.keyword === "oneOf") return undefined;

	const stepMatch = /^\/steps\/(\d+)(?:\/([^/]+))?$/.exec(error.path);
	if (stepMatch) {
		const stepIndex = Number(stepMatch[1]);
		const field = stepMatch[2];
		const step = spec.steps[stepIndex];
		const label = `Step ${stepIndex + 1}${step?.type ? ` (${step.type})` : ""}`;

		if (field === "id" && error.keyword === "pattern") {
			return { path: error.path, message: `${label} id: ${STEP_ID_REQUIREMENT}` };
		}
		if (field === "type" && error.keyword === "const" && step?.type) {
			return undefined;
		}
		if (error.keyword === "required") {
			const missing = typeof error.params.missingProperty === "string"
				? error.params.missingProperty
				: undefined;
			if (!missing) return { path: error.path, message: `${label}: ${error.message}` };
			if (step?.type && !REQUIRED_BY_TYPE[step.type].includes(missing)) return undefined;
			return { path: error.path, message: `${label}: missing ${missing}` };
		}
		return { path: error.path, message: `${label}${field ? ` ${field}` : ""}: ${error.message}` };
	}

	return { path: error.path || "/", message: `${error.path || "/"}: ${error.message}` };
}

/** Validation errors regrouped so each one can sit at the field it belongs to. */
export interface RoutineFieldErrors {
	/** `name`, `trigger`, … → message. */
	top: Record<string, string>;
	/** step id → field → message. Required-but-missing fields are keyed by name. */
	steps: Map<string, Record<string, string>>;
	/** Everything, for a "what needs attention" count. */
	count: number;
}

/**
 * Validation errors regrouped by field, plus the one check the schema does
 * not make uniformly: a required text field that is present but empty (an
 * `http` step with `url: ""`) is reported as "Required." at that field.
 */
export function fieldErrorsForSpec(
	errors: readonly ValidationError[] | undefined,
	spec: RoutineSpec,
): RoutineFieldErrors {
	const top: Record<string, string> = {};
	const steps = new Map<string, Record<string, string>>();
	let count = 0;
	function put(stepId: string, field: string, message: string): void {
		const bucket = steps.get(stepId) ?? {};
		if (bucket[field]) return;
		bucket[field] = message;
		steps.set(stepId, bucket);
		count += 1;
	}
	for (const error of errors ?? []) {
		if (error.keyword === "oneOf") continue;
		const stepMatch = /^\/steps\/(\d+)(?:\/([^/]+))?/.exec(error.path);
		if (stepMatch) {
			const step = spec.steps[Number(stepMatch[1])];
			if (!step) continue;
			let field = stepMatch[2];
			if (error.keyword === "required") {
				const missing = typeof error.params.missingProperty === "string" ? error.params.missingProperty : undefined;
				if (!missing || !REQUIRED_BY_TYPE[step.type].includes(missing)) continue;
				field = missing;
			}
			if (!field || field === "type") continue;
			put(step.id, field, friendlyFieldMessage(field, error));
			continue;
		}
		const topMatch = /^\/([^/]+)/.exec(error.path);
		const key = topMatch?.[1] ?? "/";
		if (top[key]) continue;
		top[key] = friendlyFieldMessage(key, error);
		count += 1;
	}
	for (const step of spec.steps) {
		for (const field of REQUIRED_BY_TYPE[step.type]) {
			if (field === "type") continue;
			const value = (step as unknown as Record<string, unknown>)[field];
			if (typeof value === "string" && value.trim().length === 0) put(step.id, field, "Required.");
		}
	}
	return { top, steps, count };
}

function friendlyFieldMessage(field: string, error: ValidationError): string {
	if (field === "id" && error.keyword === "pattern") return "Use lowercase letters, numbers and underscores, starting with a letter.";
	if (error.keyword === "required" || error.keyword === "minLength") return "Required.";
	if (error.keyword === "minItems") return "Add at least one.";
	if (!error.message) return "Invalid.";
	return `${error.message[0]!.toUpperCase()}${error.message.slice(1)}.`;
}
