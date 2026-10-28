import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { GraphRunRecord, RoutineRun } from "@npi-deck/protocol";
import { routinesApi, RoutineRequestError } from "@/lib/routines-api";
import { routineRunActive, useGraphRunTrace } from "./use-graph-run-trace";

const originalRun = routinesApi.run, originalGraphRun = routinesApi.graphRun;
let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useGraphRunTrace> | undefined;
afterEach(() => {
	if (renderer) act(() => renderer!.unmount());
	renderer = undefined; result = undefined;
	routinesApi.run = originalRun; routinesApi.graphRun = originalGraphRun;
});
function summary(endedAt?: string): RoutineRun {
	return { id: "older-than-latest-50", routineId: "routine", startedAt: "2026-01-01T00:00:00Z", endedAt, exitCode: endedAt ? 0 : undefined, trigger: "manual", stdoutExcerpt: "", stderrExcerpt: "", totalLlmCostMicros: 0, totalLlmTokens: 0, stepCountTotal: 0, stepCountFailed: 0 };
}
function saved(): GraphRunRecord {
	return { id: "older-than-latest-50", routineId: "routine", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:01Z", activation: { eventType: "manual", event: { value: false } }, graph: { version: 2, nodes: [], edges: [] }, status: "success", nodeRuns: [], outputs: [] };
}
function Probe({ runId = "older-than-latest-50", preview }: { runId?: string; preview?: GraphRunRecord }) {
	result = useGraphRunTrace("routine", runId, { preview });
	return null;
}
async function mount(preview?: GraphRunRecord): Promise<void> {
	await act(async () => { renderer = create(<Probe preview={preview} />); });
}

describe("native trace loading", () => {
	test("looks up the requested historical run directly", async () => {
		const run = mock(async () => summary("2026-01-01T00:00:01Z"));
		const graphRun = mock(async () => saved());
		routinesApi.run = run; routinesApi.graphRun = graphRun;
		await mount();
		expect(run).toHaveBeenCalledWith("routine", "older-than-latest-50");
		expect(graphRun).toHaveBeenCalledWith("routine", "older-than-latest-50");
		expect(result?.state).toBe("ready");
		expect(result?.trace?.activation.event.value).toBe(false);
	});

	test("keeps previews local and never looks them up in persisted history", async () => {
		const run = mock(async () => summary()), graphRun = mock(async () => saved());
		routinesApi.run = run; routinesApi.graphRun = graphRun;
		const preview = { ...saved(), dryRun: true };
		await mount(preview);
		expect(run).not.toHaveBeenCalled();
		expect(graphRun).not.toHaveBeenCalled();
		expect(result?.trace).toBe(preview);
		expect(result?.state).toBe("ready");
	});

	test("distinguishes a running unavailable trace from a completed finalizing one", async () => {
		routinesApi.run = async () => summary();
		routinesApi.graphRun = async () => { throw new RoutineRequestError("not yet available", 404); };
		await mount();
		expect(result?.state).toBe("running");
		expect(result?.trace).toBeNull();
		act(() => renderer!.unmount()); renderer = undefined;
		routinesApi.run = async () => summary("2026-01-01T00:00:01Z");
		await mount();
		expect(result?.state).toBe("finalizing");
	});

	test("reports trace fetch errors instead of treating them as missing provenance", async () => {
		routinesApi.run = async () => summary("2026-01-01T00:00:01Z");
		routinesApi.graphRun = async () => { throw new RoutineRequestError("storage unavailable", 503); };
		await mount();
		expect(result?.state).toBe("error");
		expect(result?.error).toContain("storage unavailable");
	});

	test("an aborted run is terminal even when endedAt is absent", () => {
		expect(routineRunActive({ ...summary(), abortedAt: "2026-01-01T00:00:01Z", abortReason: "cancelled" })).toBe(false);
	});
});
