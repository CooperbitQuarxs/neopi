/**
 * Inspector for the selected canvas step. Name first (the canvas title comes
 * from it), then the per-type form, then the advanced common fields, then
 * the last run. Every validation message is at the field it belongs to.
 */

import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { RoutineStep, RoutineStepRun, RoutineStepStatus } from "@npi-deck/protocol";

import { cn } from "@/lib/utils";

import { Field, TextArea } from "../form-primitives";
import { StepCommonFields, StepIdField } from "../StepCommonFields";
import type { StepFieldErrors } from "../StepForms";
import { actionLabel, renderStepForm, STEP_ICON, stepIconTone, stepTitle } from "../step-form-render";
import { InspectorShell, type InspectorMode } from "./InspectorShell";

interface StepInspectorProps {
	step: RoutineStep;
	/** All step ids in the spec — used to surface "duplicate id" warnings. */
	existingIds: string[];
	/** Validation messages for this step, keyed by field. */
	errors?: StepFieldErrors;
	onChange: (next: RoutineStep) => void;
	onClose: () => void;
	onDelete: () => void;
	mode: InspectorMode;
	/** If-flavored transform: swap the body editor for a condition editor. */
	isIfNode?: boolean;
	stepRun?: RoutineStepRun;
	routineId?: string;
	selectedRunId?: string | null;
	advanced?: boolean;
	allowDelete?: boolean;
}

export function StepInspector({
	step,
	existingIds,
	errors,
	onChange,
	onClose,
	onDelete,
	mode,
	isIfNode,
	stepRun,
	routineId,
	selectedRunId,
	advanced = false,
	allowDelete = true,
}: StepInspectorProps): JSX.Element {
	const Icon = STEP_ICON[step.type];
	const idsExcludingSelf = existingIds.filter((id) => id !== step.id);
	return (
		<InspectorShell
			mode={mode}
			icon={<Icon size={14} />}
			iconTone={stepIconTone(step)}
			title={stepTitle(step)}
			kicker={actionLabel(step)}
			onClose={onClose}
			ariaLabel={`${actionLabel(step)} inspector`}
			testId="step-inspector"
			actions={
				allowDelete ? (
					<button
						type="button"
						onClick={onDelete}
						className="neo-btn text-ink-3 hover:!text-danger"
						data-variant="ghost"
						data-size="sm"
						data-icon="true"
						aria-label="Delete action"
						title="Delete action"
					>
						<Trash2 size={14} />
					</button>
				) : null
			}
		>
			<StepIdField step={step} onChange={onChange} existingIds={idsExcludingSelf} errors={errors} />
			{advanced && isIfNode && step.type === "transform" ? (
				<BranchConditionForm step={step} onChange={onChange} error={errors?.body} />
			) : (
				renderStepForm(step, onChange, advanced, errors)
			)}
			{advanced ? (
				<section className="space-y-3 border-t border-[var(--neo-line-1)] pt-4">
					<h3 className="text-[12px] font-medium text-ink-3">When it runs and what happens if it fails</h3>
					<StepCommonFields step={step} onChange={onChange} errors={errors} />
				</section>
			) : null}
			{stepRun ? (
				<LastRunSection
					run={stepRun}
					routineId={routineId}
					runId={selectedRunId ?? stepRun.runId}
				/>
			) : null}
		</InspectorShell>
	);
}

/**
 * Simplified body editor for if-flavored transform steps. The shape is
 * identical to the underlying transform step — only the framing changes —
 * so toggling between if-flavored and regular transform via the source
 * view doesn't lose data.
 */
function BranchConditionForm({
	step,
	onChange,
	error,
}: {
	step: Extract<RoutineStep, { type: "transform" }>;
	onChange: (next: RoutineStep) => void;
	error?: string;
}): JSX.Element {
	return (
		<Field
			label="Condition"
			help={<>Wire the <span className="text-success">true</span> and <span className="text-danger">false</span> handles to the steps each branch should run. JavaScript; same globals as a transform.</>}
			error={error}
		>
			<TextArea
				value={step.body}
				onChange={(v) => onChange({ ...step, body: v })}
				rows={4}
				placeholder={"return steps.fetch_tasks.json.length > 0;"}
			/>
		</Field>
	);
}

/**
 * Per-step last-run section, rendered at the bottom of the inspector
 * whenever a run record is available for the selected node.
 */
function LastRunSection({
	run,
	routineId,
	runId,
}: {
	run: RoutineStepRun;
	routineId?: string;
	runId?: string | null;
}): JSX.Element {
	type Pane = "stdout" | "stderr" | "json" | "error";
	const tabs: Pane[] = [];
	if (run.stdoutExcerpt) tabs.push("stdout");
	if (run.stderrExcerpt) tabs.push("stderr");
	if (run.outputJson) tabs.push("json");
	if (run.error) tabs.push("error");
	const [tab, setTab] = useState<Pane | null>(tabs[0] ?? null);
	useEffect(() => {
		setTab(tabs[0] ?? null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run.id]);

	const dur = run.durationMs != null ? formatDur(run.durationMs) : "—";
	const deepLink =
		routineId && runId
			? `/legacy/routines/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(runId)}#step-${encodeURIComponent(run.stepId)}`
			: null;

	return (
		<section className="neo-card" data-testid="inspector-last-run">
			<header className="flex items-center gap-2 border-b border-[var(--neo-line-1)] px-3 py-2">
				<span className="text-[12.5px] font-medium text-ink">Last run</span>
				<StatusPill status={run.status} />
				<span className="neo-mono text-[12px] text-ink-3">{dur}</span>
				{deepLink ? (
					<Link
						to={deepLink}
						className="ml-auto flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"
						title="Open in run detail"
					>
						<ExternalLink size={12} />
						Run detail
					</Link>
				) : null}
			</header>

			{tabs.length === 0 ? (
				<div className="px-3 py-3 text-[12px] text-ink-3">No captured output for this step.</div>
			) : (
				<>
					<div className="neo-tabs px-2">
						{tabs.map((t) => (
							<button
								key={t}
								type="button"
								onClick={() => setTab(t)}
								className="neo-tab !h-8 !px-2.5 !text-[12px]"
								data-active={tab === t}
							>
								{t}
							</button>
						))}
					</div>
					<div className="p-2">
						<PaneBody pane={tab} run={run} />
					</div>
				</>
			)}
		</section>
	);
}

function PaneBody({
	pane,
	run,
}: {
	pane: "stdout" | "stderr" | "json" | "error" | null;
	run: RoutineStepRun;
}): JSX.Element | null {
	if (!pane) return null;
	const text =
		pane === "stdout"
			? run.stdoutExcerpt
			: pane === "stderr"
				? run.stderrExcerpt
				: pane === "json"
					? prettyJson(run.outputJson ?? "")
					: (run.error ?? "");
	const tone = pane === "stderr" || pane === "error" ? "text-warn" : undefined;
	return (
		<pre className={cn("neo-code-block max-h-[260px]", tone)}>
			{text || "(empty)"}
		</pre>
	);
}

function StatusPill({ status }: { status: RoutineStepStatus }): JSX.Element {
	const tone =
		status === "success" ? "ok" : status === "failed" ? "bad" : status === "aborted" ? "warn" : status === "running" ? "accent" : undefined;
	return (
		<span className="neo-badge" data-tone={tone}>
			{status}
		</span>
	);
}

function formatDur(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const rem = Math.round(s - m * 60);
	return `${m}m${rem}s`;
}

function prettyJson(raw: string): string {
	if (!raw) return "";
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}
