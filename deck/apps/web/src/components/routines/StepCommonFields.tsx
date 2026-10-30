import type { RoutineOnFailure, RoutineRetryPolicy, RoutineStep } from "@npi-deck/protocol";

import { Field, NumInput, Select, TextInput } from "./form-primitives";
import { validateStepId } from "./routine-validation";
import type { StepFieldErrors } from "./StepForms";

interface Props {
	step: RoutineStep;
	onChange: (next: RoutineStep) => void;
	existingIds: string[];
	errors?: StepFieldErrors;
}

/**
 * The step's id, shown on every step because the canvas reads it as the
 * node's title (`fetch_tasks` → "Fetch tasks").
 */
export function StepIdField({ step, onChange, existingIds, errors }: Props) {
	const idCollision = existingIds.includes(step.id);
	const idError = idCollision ? "Another step already uses this name." : validateStepId(step.id);
	return (
		<Field
			label="Name"
			help="Lowercase, numbers and underscores. Other steps refer to this one by it."
			error={errors?.id ?? idError}
		>
			<TextInput value={step.id} onChange={(v) => onChange({ ...step, id: v })} placeholder="fetch_tasks" mono ariaLabel="Step name" />
		</Field>
	);
}

/**
 * Renders the `when`, `on_failure`, `timeout_secs`, and `retry` fields
 * shared by every step type. Advanced only; the per-type form mounts above.
 */
export function StepCommonFields({ step, onChange, errors }: Omit<Props, "existingIds">) {
	function set<K extends keyof RoutineStep>(key: K, value: RoutineStep[K]): void {
		onChange({ ...step, [key]: value });
	}
	function clear(key: keyof RoutineStep): void {
		const next = { ...step };
		delete (next as Record<string, unknown>)[key];
		onChange(next);
	}
	const retry = step.retry;

	return (
		<div className="space-y-3">
			<Field label="Run only when" optional help="A JavaScript expression; the step is skipped when it is false." error={errors?.when}>
				<TextInput
					value={step.when ?? ""}
					onChange={(v) => (v.trim() === "" ? clear("when") : set("when", v))}
					placeholder="state.last_run_date !== run.date"
					mono
				/>
			</Field>
			<div className="grid grid-cols-2 gap-3">
				<Field label="On failure" error={errors?.on_failure}>
					<Select
						value={step.on_failure ?? ""}
						onChange={(v) => {
							if (v === "") clear("on_failure");
							else set("on_failure", v as RoutineOnFailure);
						}}
						options={[
							{ value: "", label: "Stop the routine" },
							{ value: "abort", label: "Stop the routine (explicit)" },
							{ value: "continue", label: "Carry on" },
							{ value: "retry", label: "Retry" },
						]}
					/>
				</Field>
				<Field label="Timeout" optional help="Seconds." error={errors?.timeout_secs}>
					<NumInput
						value={step.timeout_secs}
						onChange={(v) => (v === undefined ? clear("timeout_secs") : set("timeout_secs", v))}
						placeholder="120"
					/>
				</Field>
			</div>
			{step.on_failure === "retry" ? (
				<div className="grid grid-cols-3 gap-3">
					<Field label="Retries" error={errors?.retry}>
						<NumInput
							value={retry?.times}
							onChange={(v) => {
								if (v === undefined) {
									clear("retry");
									return;
								}
								const next: RoutineRetryPolicy = retry
									? { ...retry, times: v }
									: { times: v, backoff: "linear" };
								set("retry", next);
							}}
							placeholder="3"
						/>
					</Field>
					<Field label="Backoff">
						<Select
							value={retry?.backoff ?? "linear"}
							onChange={(backoff) => {
								const next: RoutineRetryPolicy = retry
									? { ...retry, backoff }
									: { times: 3, backoff };
								set("retry", next);
							}}
							options={[
								{ value: "linear", label: "Linear" },
								{ value: "exponential", label: "Exponential" },
							]}
						/>
					</Field>
					<Field label="Max delay" optional help="Seconds.">
						<NumInput
							value={retry?.max_delay_secs}
							onChange={(v) => {
								if (!retry) return;
								const next: RoutineRetryPolicy = { ...retry };
								if (v === undefined) delete next.max_delay_secs;
								else next.max_delay_secs = v;
								set("retry", next);
							}}
							placeholder="60"
						/>
					</Field>
				</div>
			) : null}
		</div>
	);
}
