/**
 * Categorized add-step palette pinned to the top-left corner of the canvas
 * viewport: one button, one click, scannable groups. The popover closes on
 * outside-click and Escape; in Advanced each row shows its help text inline.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch, Plus } from "lucide-react";

import type { RoutineDeckAction, RoutineStep } from "@npi-deck/protocol";

import { STEP_CATEGORIES } from "./step-categories";
import { actionLabel, STEP_ICON, stepIconTone } from "../step-form-render";

interface AddStepPaletteProps {
	onAdd: (
		type: RoutineStep["type"],
		presetAction?: RoutineDeckAction,
		presetKind?: "if",
	) => void;
	advanced?: boolean;
}

const CATEGORY_WORDS: Record<string, string> = {
	compute: "Commands and agents",
	io: "Outside the deck",
	"deck-read": "Read from the deck",
	"deck-write": "Update the deck",
	file: "Files",
	control: "Control",
};

export function AddStepPalette({ onAdd, advanced = false }: AddStepPaletteProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement | null>(null);

	// Close on outside click + Escape so the popover behaves like a menu.
	useEffect(() => {
		if (!open) return;
		function onDocPointer(e: MouseEvent | TouchEvent) {
			if (!wrapRef.current) return;
			if (wrapRef.current.contains(e.target as Node)) return;
			setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDocPointer);
		document.addEventListener("touchstart", onDocPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocPointer);
			document.removeEventListener("touchstart", onDocPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	function pick(
		type: RoutineStep["type"],
		presetAction?: RoutineDeckAction,
		presetKind?: "if",
	) {
		onAdd(type, presetAction, presetKind);
		setOpen(false);
	}

	return (
		<div
			ref={wrapRef}
			className="pointer-events-auto absolute left-3 top-3 z-20"
			data-testid="add-step-palette"
		>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Add action"
				className="neo-btn"
				data-variant="primary"
			>
				<Plus size={14} />
				Add action
				<ChevronDown size={12} className={`opacity-70 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open ? (
				<div
					role="menu"
					aria-label="Choose an action"
					className="neo-card mt-1.5 max-h-[70vh] w-[340px] overflow-y-auto !shadow-[var(--neo-shadow-3)]"
				>
					{STEP_CATEGORIES.filter((cat) => advanced || cat.key !== "io").map((cat, i) => (
						<div key={cat.key} className={i === 0 ? "" : "border-t border-[var(--neo-line-1)]"}>
							<div className="px-3 pb-1 pt-2.5 text-[11.5px] font-medium text-ink-3">
								{CATEGORY_WORDS[cat.key] ?? cat.label}
							</div>
							<div className="pb-1.5">
								{cat.entries.filter((entry) => advanced || (
									!["transform", "if", "set_state"].includes(entry.key) &&
									!["move_task", "get_task", "get_inbox_item", "promote_inbox_item_to_task"].includes(entry.presetAction ?? "")
								)).map((entry) => {
									const Icon = entry.presetKind === "if" ? GitBranch : STEP_ICON[entry.value];
									const label = entry.presetKind === "if" ? "Branch on a condition" : actionLabel({ type: entry.value, action: entry.presetAction });
									return (
										<button
											key={entry.key}
											type="button"
											role="menuitem"
											onClick={() => pick(entry.value, entry.presetAction, entry.presetKind)}
											aria-label={`Add ${actionLabel({ type: entry.value, action: entry.presetAction })}`}
											className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--neo-hover)]"
										>
											<span className="neo-node-icon !h-[22px] !w-[22px]" data-tone={stepIconTone({ type: entry.value })}><Icon size={12} /></span>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[13px] text-ink">{label}</span>
												{advanced ? <span className="block text-[11.5px] leading-snug text-ink-3">{entry.help}</span> : null}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
