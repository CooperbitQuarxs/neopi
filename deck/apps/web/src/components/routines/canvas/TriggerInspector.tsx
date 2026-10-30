/**
 * Inspector for the trigger node: edits the routine's `trigger:` list in
 * place, so what starts the routine is one click away from the canvas.
 */

import { Zap } from "lucide-react";

import type { RoutineTrigger } from "@npi-deck/protocol";

import { describeTrigger } from "../trigger-summary";
import { TriggerPicker } from "../TriggerPicker";
import { InspectorShell, type InspectorMode } from "./InspectorShell";

export function TriggerInspector({
	triggers,
	onChange,
	onClose,
	mode,
	error,
}: {
	triggers: RoutineTrigger[];
	onChange: (next: RoutineTrigger[]) => void;
	onClose: () => void;
	mode: InspectorMode;
	error?: string;
}): JSX.Element {
	const first = triggers[0] ? describeTrigger(triggers[0]) : undefined;
	return (
		<InspectorShell
			mode={mode}
			icon={<Zap size={14} />}
			iconTone="accent"
			title="When it runs"
			kicker={first ? `${first.text}${triggers.length > 1 ? ` and ${triggers.length - 1} more` : ""}` : "No trigger yet"}
			onClose={onClose}
			ariaLabel="Trigger inspector"
			testId="trigger-inspector"
		>
			<TriggerPicker triggers={triggers} onChange={onChange} error={error} />
		</InspectorShell>
	);
}
