/**
 * Shared rendering helpers for routine steps.
 *
 * The canvas node, the canvas inspector and the form-mode card all need the
 * same three things for a step: a readable title, an icon, and the per-type
 * form. Keeping them here keeps the surfaces in lockstep: a new step type
 * gets a `case` here and every surface picks it up.
 */

import {
	Bot,
	Clock,
	Database,
	FilePen,
	Globe,
	LayoutGrid,
	Plug,
	Shuffle,
	Terminal,
	type LucideIcon,
} from "lucide-react";
import type { RoutineStep } from "@npi-deck/protocol";

import { AdvancedNotice, Field } from "./form-primitives";
import {
	AgentStepForm,
	DeckStepForm,
	HttpStepForm,
	McpStepForm,
	RunStepForm,
	SetStateStepForm,
	type StepFieldErrors,
	TransformStepForm,
	WaitStepForm,
	WriteStepForm,
} from "./StepForms";

/** Icon per step type. The agent is the engine's side of a routine and gets the iris tone. */
export const STEP_ICON: Record<RoutineStep["type"], LucideIcon> = {
	run: Terminal,
	agent: Bot,
	write: FilePen,
	http: Globe,
	deck: LayoutGrid,
	mcp: Plug,
	transform: Shuffle,
	wait: Clock,
	set_state: Database,
};

export function stepIconTone(step: Pick<RoutineStep, "type">): "engine" | "accent" | undefined {
	if (step.type === "agent") return "engine";
	if (step.type === "deck") return "accent";
	return undefined;
}

/** User-facing action names, independent of the persisted type identifiers. */
export function actionLabel(step: Pick<RoutineStep, "type"> & { action?: string }): string {
	if (step.type === "deck") {
		const names: Record<string, string> = {
			create_inbox_item: "Create inbox item", create_task: "Create card",
			move_task: "Move card", promote_inbox_item_to_task: "Make a card from inbox",
			list_tasks: "Find cards", list_inbox: "Read inbox", get_task: "Read card",
			get_inbox_item: "Read inbox item", kb_orphan_census: "Find unlinked notes",
			kb_read: "Read a note",
		};
		return names[step.action ?? ""] ?? "Deck action";
	}
	const names: Record<RoutineStep["type"], string> = {
		run: "Run command", agent: "Ask an agent", write: "Write file",
		http: "Send request", mcp: "Use integration", transform: "Transform data",
		wait: "Wait", set_state: "Remember values", deck: "Deck action",
	};
	return names[step.type];
}

/**
 * The title a step shows on the canvas: its id, read as words. `fetch_tasks`
 * becomes "Fetch tasks"; a scaffolded `step_3` stays "Step 3". Falls back to
 * the action label when the id is empty so a node never shows a blank title.
 */
export function stepTitle(step: Pick<RoutineStep, "id" | "type"> & { action?: string }): string {
	const words = step.id.trim().split(/[_\s-]+/).filter(Boolean);
	if (words.length === 0) return actionLabel(step);
	const [first, ...rest] = words;
	return [first![0]!.toUpperCase() + first!.slice(1), ...rest].join(" ");
}

/** Dispatch to the right per-type form for `step`. */
export function renderStepForm(
	step: RoutineStep,
	onChange: (next: RoutineStep) => void,
	advanced = true,
	errors?: StepFieldErrors,
): JSX.Element {
	if (!advanced && ["write", "http", "mcp", "transform", "set_state"].includes(step.type)) {
		return <Field label="Settings">
			<AdvancedNotice>Turn on Advanced to edit this action's settings.</AdvancedNotice>
		</Field>;
	}
	switch (step.type) {
		case "run":
			return <RunStepForm step={step} onChange={onChange} advanced={advanced} errors={errors} />;
		case "agent":
			return <AgentStepForm step={step} onChange={onChange} advanced={advanced} errors={errors} />;
		case "write":
			return <WriteStepForm step={step} onChange={onChange} errors={errors} />;
		case "http":
			return <HttpStepForm step={step} onChange={onChange} errors={errors} />;
		case "deck":
			return <DeckStepForm step={step} onChange={onChange} advanced={advanced} errors={errors} />;
		case "mcp":
			return <McpStepForm step={step} onChange={onChange} errors={errors} />;
		case "transform":
			return <TransformStepForm step={step} onChange={onChange} errors={errors} />;
		case "wait":
			return <WaitStepForm step={step} onChange={onChange} errors={errors} />;
		case "set_state":
			return <SetStateStepForm step={step} onChange={onChange} errors={errors} />;
	}
}
