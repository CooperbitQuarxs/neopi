import { useCallback, useEffect, useState } from "react";
import type { GraphRunRecord, RoutineRun } from "@npi-deck/protocol";
import { RoutineRequestError, routinesApi } from "@/lib/routines-api";

export type GraphTraceState = "idle" | "loading" | "running" | "finalizing" | "missing" | "error" | "ready";
export const GRAPH_TRACE_MESSAGES: Record<GraphTraceState, string> = {
	idle: "Choose a run to inspect its stored execution.",
	loading: "Loading the stored execution…",
	running: "This run is still running. Its full provenance becomes available when execution finishes. Live step updates are not a graph trace.",
	finalizing: "Execution has finished. The runner is finalizing its stored graph trace…",
	missing: "This completed run has no stored graph trace. Its provenance cannot be reconstructed from legacy step records.",
	error: "The stored graph trace could not be loaded.",
	ready: "",
};

export function routineRunActive(run: RoutineRun): boolean {
	return !run.endedAt && !run.abortedAt && !run.abortReason;
}

/** Native traces finalize at completion. Poll summaries, never invent live provenance. */
export function useGraphRunTrace(routineId: string | undefined, runId: string | null, options: { enabled?: boolean; preview?: GraphRunRecord | null } = {}) {
	const { enabled = true, preview } = options;
	const [run, setRun] = useState<RoutineRun | null>(null);
	const [trace, setTrace] = useState<GraphRunRecord | null>(null);
	const [state, setState] = useState<GraphTraceState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	const selection = `${routineId ?? ""}/${runId ?? ""}`;
	const [loadedSelection, setLoadedSelection] = useState("");
	const refresh = useCallback(() => setRevision(value => value + 1), []);
	useEffect(() => {
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let completedMisses = 0;
		setRun(null); setTrace(null); setError(null);
		setLoadedSelection(selection);
		if (!enabled || !routineId || !runId) { setState("idle"); return; }
		if (preview?.id === runId) { setTrace(preview); setState("ready"); return; }
		setState("loading");
		async function load(): Promise<void> {
			let nextRun: RoutineRun;
			try {
				nextRun = await routinesApi.run(routineId!, runId!);
				if (!alive) return;
				setRun(nextRun);
			} catch (reason) {
				if (alive) { setState("error"); setError(`Run lookup failed. ${String(reason)}`); }
				return;
			}
			try {
				const nextTrace = await routinesApi.graphRun(routineId!, runId!);
				if (!alive) return;
				setTrace(nextTrace); setState("ready"); setError(null);
			} catch (reason) {
				if (!alive) return;
				if (reason instanceof RoutineRequestError && reason.status === 404) {
					setError(null);
					if (routineRunActive(nextRun)) setState("running");
					else { completedMisses++; setState(completedMisses < 3 ? "finalizing" : "missing"); }
				} else { setState("error"); setError(String(reason)); }
				if (routineRunActive(nextRun) || completedMisses > 0 && completedMisses < 3) timer = setTimeout(() => void load(), 1500);
			}
		}
		void load();
		return () => { alive = false; if (timer) clearTimeout(timer); };
	}, [routineId, runId, enabled, preview, revision, selection]);
	const current = enabled && !!routineId && !!runId && loadedSelection === selection;
	return { run: current ? run : null, trace: current ? trace : null, state: current ? state : enabled && runId ? "loading" as const : "idle" as const, error: current ? error : null, refresh };
}
