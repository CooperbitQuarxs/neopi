import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GraphRunRecord, Routine, RoutineRun } from "@npi-deck/protocol";
import { Empty, ErrorState, KeyValue, formatElapsed, formatShortRelative, formatTimestamp } from "@/components/neo";
import { GraphRunProvenance } from "@/components/routines/GraphRunProvenance";
import { GRAPH_TRACE_MESSAGES, routineRunActive, useGraphRunTrace } from "@/components/routines/use-graph-run-trace";
import { routinesApi } from "@/lib/routines-api";
import { studio, type StudioGraph, type StudioRun } from "../../client/studio";
import { nodeTitle } from "./StudioCanvas";
import { StudioPanel } from "./StudioPanel";

const WORDS = { ok: "Ran", failed: "Failed", skipped: "Skipped", running: "Running" } as const;
function outcome(run: StudioRun): { tone: string; word: string } { return run.ok === null ? { tone: "running", word: "Running" } : run.ok ? { tone: "ok", word: "Passed" } : { tone: "failed", word: "Failed" }; }

function nativeSummary(run: RoutineRun): StudioRun {
	return { id: run.id, graphId: run.routineId, startedAt: run.startedAt, endedAt: run.endedAt ?? run.abortedAt, ok: routineRunActive(run) ? null : !run.error && !run.abortReason && (run.exitCode === undefined || run.exitCode === 0) && !run.stepCountFailed, trigger: run.trigger, costUsd: run.totalLlmCostMicros / 1_000_000, nodes: [] };
}
function previewSummary(trace: GraphRunRecord): StudioRun {
	return { id: trace.id, graphId: trace.routineId, startedAt: trace.startedAt, endedAt: trace.endedAt, ok: trace.status === "success", trigger: trace.activation.eventType, mode: "preview", nodes: [] };
}

export interface RunsPanelProps {
	graphId: string;
	graph?: StudioGraph;
	routine?: Routine;
	refresh: number;
	selected: string | null;
	onSelect: (run: StudioRun | null) => void;
	onTrace?: (trace: GraphRunRecord | null) => void;
	preview?: GraphRunRecord | null;
	onClose: () => void;
}

/** One dock for Studio runs and native routine snapshot/provenance inspection. */
export function RunsPanel({ graphId, graph, routine, refresh, selected, onSelect, onTrace, preview, onClose }: RunsPanelProps) {
	const native = routine?.specVersion === 2;
	const routineId = routine?.id ?? graphId;
	const [runs, setRuns] = useState<StudioRun[]>([]);
	const [nativeRuns, setNativeRuns] = useState<RoutineRun[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const selectRef = useRef(onSelect), traceRef = useRef(onTrace), selectedRef = useRef(selected);
	selectRef.current = onSelect; traceRef.current = onTrace; selectedRef.current = selected;
	const inspection = useGraphRunTrace(routineId, selected, { enabled: native, preview });
	useEffect(() => {
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let polls = 0;
		setLoading(true); setError(""); setRuns([]); setNativeRuns([]);
		async function load(): Promise<void> {
			try {
				const nativeList = native ? (await routinesApi.runs(routineId, 30)).runs : undefined;
				const next = nativeList ? nativeList.map(nativeSummary) : await studio.runs(graphId);
				if (!alive) return;
				const sorted = [...next].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
				setRuns(sorted); setNativeRuns(nativeList ?? []); setLoading(false); setError("");
				const current = selectedRef.current;
				const keep = sorted.find(item => item.id === current) ?? (!current && refresh > 0 ? sorted[0] : undefined);
				if (keep) selectRef.current(keep);
				else if (!current) selectRef.current(null);
				polls++;
				if (native && (nativeList?.some(routineRunActive) || refresh > 0 && polls < 3)) timer = setTimeout(() => void load(), 1500);
			} catch (reason) { if (alive) { setError(String(reason)); setLoading(false); } }
		}
		void load();
		return () => { alive = false; if (timer) clearTimeout(timer); };
	}, [graphId, routineId, native, refresh]);
	useEffect(() => {
		if (native && preview) selectRef.current(previewSummary(preview));
	}, [native, preview]);
	useEffect(() => {
		traceRef.current?.(native && inspection.trace?.id === selected ? inspection.trace : null);
	}, [native, inspection.trace, selected]);

	const localPreview = native && preview ? previewSummary(preview) : null;
	const listed = localPreview ? [localPreview, ...runs.filter(item => item.id !== localPreview.id)] : runs;
	const run = listed.find(item => item.id === selected) ?? (native && inspection.run?.id === selected ? nativeSummary(inspection.run) : undefined);
	const selectedSummary = nativeRuns.find(item => item.id === selected) ?? inspection.run;
	return <StudioPanel title="Runs" subtitle={native ? "Inspect the graph and values saved with each execution." : graph ? "Each run is one input walking this graph." : "Each run is one execution of this flow."} onClose={onClose}>
		{error ? <ErrorState error={error} /> : null}
		{loading && !localPreview ? <p className="neo-studio-help">Loading runs…</p> : listed.length === 0 ? <Empty title="No runs yet" hint={native ? "Preview a matching source to inspect values without sending actions. Manual execution activates manual sources, not inbox-only sources." : graph ? "Preview run walks the graph with a sample input and sends nothing outside the deck." : "Run now starts the flow once; scheduled runs appear here too."} /> : <div className="neo-studio-runs" role="group" aria-label="Runs, newest first">
			{listed.map(item => {
				const o = outcome(item), summary = nativeRuns.find(candidate => candidate.id === item.id);
				return <button key={item.id} type="button" aria-pressed={item.id === selected} className="neo-studio-run-row" data-current={item.id === selected || undefined} onClick={() => onSelect(item.id === selected ? null : item)}>
					<i data-run={o.tone} /><span>{summary?.abortReason ? "Aborted" : o.word}</span><small>{item.id === localPreview?.id ? "Unsaved preview" : item.mode === "execute" ? "Executed" : item.mode === "preview" ? "Preview" : item.trigger}{item.mode && item.trigger && !/preview/i.test(item.trigger) ? `, ${item.trigger}` : ""}</small><time dateTime={item.startedAt} title={formatTimestamp(item.startedAt)}>{formatShortRelative(item.startedAt)}</time>
				</button>;
			})}
		</div>}
		{run ? <section className="neo-studio-run-detail" aria-label="Selected run">
			<KeyValue items={[{ key: "Started", value: formatTimestamp(run.startedAt) }, { key: "Duration", value: run.endedAt ? formatElapsed(Date.parse(run.endedAt) - Date.parse(run.startedAt)) : "Still running" }, { key: "Cost", value: run.costUsd !== undefined ? `$${run.costUsd.toFixed(3)}` : "Unknown" }]} />
			{native ? <>
				{inspection.trace?.id === selected ? <GraphRunProvenance trace={inspection.trace} /> : <p className="neo-studio-help" role={inspection.state === "error" ? "alert" : "status"}>{GRAPH_TRACE_MESSAGES[inspection.state]}{inspection.error ? ` ${inspection.error}` : ""}</p>}
				{selectedSummary?.error ? <p className="neo-studio-help">{selectedSummary.error}</p> : null}
				{run.id !== localPreview?.id ? <Link className="neo-btn" to={`/legacy/routines/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(run.id)}`}>Open run detail</Link> : <p className="neo-studio-help">This write-free preview is local to this editor session. It is not persisted in run history.</p>}
			</> : <>
				{graph ? <p className="neo-studio-help">Outcomes are drawn on the canvas. Select the run again to clear them.</p> : null}
				<ol className="neo-studio-run-steps">{run.nodes.length === 0 ? <li className="neo-studio-help">The runner has not recorded any steps yet.</li> : run.nodes.map((step, index) => { const node = graph?.nodes.find(n => n.id === step.nodeId); return <li key={`${step.nodeId}-${index}`}><i data-run={step.status} /><span><strong>{node ? nodeTitle(node) : step.nodeId}</strong><small>{WORDS[step.status]}{step.endedAt ? `, ${formatElapsed(Date.parse(step.endedAt) - Date.parse(step.startedAt))}` : ""}</small>{step.note ? <p>{step.note}</p> : null}</span></li>; })}</ol>
			</>}
		</section> : selected && native ? <p className="neo-studio-help" role="status">{GRAPH_TRACE_MESSAGES[inspection.state]}{inspection.error ? ` ${inspection.error}` : ""}</p> : <p className="neo-studio-help">Choose a run to inspect what happened.</p>}
	</StudioPanel>;
}
