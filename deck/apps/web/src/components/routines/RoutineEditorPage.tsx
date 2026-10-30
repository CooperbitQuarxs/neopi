import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Routine } from "@npi-deck/protocol";

import { NeoButton } from "@/components/neo";
import { routinesApi } from "@/lib/routines-api";
import { RoutineBuilder } from "./RoutineBuilder";

interface Props {
	routine: Routine | "new";
	onSaved: (saved: Routine) => void;
	onDeleted: (id: string) => void;
}

export function RoutineEditorPage({ routine, onSaved, onDeleted }: Props) {
	const [error, setError] = useState<string>();
	const isNew = routine === "new";

	async function remove(): Promise<void> {
		if (routine === "new" || !confirm(`Delete routine "${routine.name}"?`)) return;
		try {
			await routinesApi.remove(routine.id);
			onDeleted(routine.id);
		} catch (e) {
			setError(String(e));
		}
	}
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="neo-page-header shrink-0 !pb-3">
				<div className="min-w-0">
					<h1 className="neo-page-title">{isNew ? "New routine" : routine.name}</h1>
					<p className="neo-page-description">{isNew ? "Start with an event source. Connect the values each node receives." : routine.description || "No description yet."}</p>
				</div>
				{!isNew ? (
					<div className="neo-page-actions">
						<NeoButton variant="ghost" size="sm" className="text-danger" onClick={() => void remove()}>
							<Trash2 size={13} />
							Delete
						</NeoButton>
					</div>
				) : null}
			</header>
			{error ? <div role="alert" className="mb-3 rounded-[var(--r-control)] border border-danger/30 bg-[var(--neo-bad-soft)] px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
			<div className="flex min-h-0 flex-1 flex-col">
				<RoutineBuilder routine={isNew ? undefined : routine} onSaved={(saved) => { setError(undefined); onSaved(saved); }} onError={setError} />
			</div>
		</div>
	);
}
