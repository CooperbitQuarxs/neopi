import { useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Trash2 } from "lucide-react";

import type { RoutineStep } from "@npi-deck/protocol";

import { StepCommonFields, StepIdField } from "./StepCommonFields";
import type { StepFieldErrors } from "./StepForms";
import { actionLabel, renderStepForm, STEP_ICON, stepIconTone, stepTitle } from "./step-form-render";

interface Props {
	step: RoutineStep;
	index: number;
	total: number;
	existingIds: string[];
	errors?: StepFieldErrors;
	onChange: (next: RoutineStep) => void;
	onRemove: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={danger ? "neo-btn text-ink-3 hover:!text-danger" : "neo-btn"}
			data-variant="ghost"
			data-size="sm"
			data-icon="true"
			aria-label={label}
			title={label}
		>
			{children}
		</button>
	);
}

export function StepCard({
	step,
	index,
	total,
	existingIds,
	errors,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
}: Props) {
	const [open, setOpen] = useState(true);
	const idsExcludingSelf = existingIds.filter((_id, i) => i !== index);
	const Icon = STEP_ICON[step.type];
	const problems = errors ? Object.keys(errors).length : 0;

	return (
		<div className="neo-card" data-problem={problems > 0 ? "true" : undefined}>
			<div className="flex items-center gap-2 px-2 py-1.5">
				<IconButton label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}>
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</IconButton>
				<span className="neo-node-icon" data-tone={stepIconTone(step)}><Icon size={13} /></span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-medium text-ink">{index + 1}. {stepTitle(step)}</div>
					<div className="truncate text-[11.5px] text-ink-3">{actionLabel(step)}{problems > 0 ? ` · ${problems} ${problems === 1 ? "field needs" : "fields need"} attention` : ""}</div>
				</div>
				<div className="flex items-center gap-0.5">
					<IconButton label="Move up" onClick={onMoveUp} disabled={index === 0}><ChevronsUp size={14} /></IconButton>
					<IconButton label="Move down" onClick={onMoveDown} disabled={index === total - 1}><ChevronsDown size={14} /></IconButton>
					<IconButton label="Remove step" onClick={onRemove} danger><Trash2 size={14} /></IconButton>
				</div>
			</div>
			{open ? (
				<div className="space-y-4 border-t border-[var(--neo-line-1)] px-3 py-3">
					<StepIdField step={step} onChange={onChange} existingIds={idsExcludingSelf} errors={errors} />
					{renderStepForm(step, onChange, true, errors)}
					<section className="space-y-3 border-t border-[var(--neo-line-1)] pt-3">
						<h3 className="text-[12px] font-medium text-ink-3">When it runs and what happens if it fails</h3>
						<StepCommonFields step={step} onChange={onChange} errors={errors} />
					</section>
				</div>
			) : null}
		</div>
	);
}
