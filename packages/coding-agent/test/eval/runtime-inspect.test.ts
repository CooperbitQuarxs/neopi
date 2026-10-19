import { afterAll, describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { disposeAllVmContexts, executeJs } from "@oh-my-pi/pi-coding-agent/eval/js";
import { disposeAllKernelSessions, executePython } from "@oh-my-pi/pi-coding-agent/eval/py/executor";
import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import type { AgentContextTelemetry } from "@oh-my-pi/pi-coding-agent/session/agent-telemetry";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const telemetry: AgentContextTelemetry = {
	type: "agent_context",
	model: { provider: "test", id: "test-model", effort: null },
	context: { usedTokens: 42, limitTokens: 100, percent: 42, estimated: true },
	compaction: { enabled: true, thresholdTokens: 80, speculationStartsAtTokens: 70, state: "idle" },
	checkpoint: { active: false },
	previousTurn: null,
	fleet: { running: 0, idle: 0, parked: 0, aborted: 0 },
};

function session(getter: ToolSession["getAgentTelemetry"]): ToolSession {
	return {
		cwd: process.cwd(),
		hasUI: false,
		getAgentTelemetry: getter,
		getToolForEvalBridge: () => {
			throw new ToolError("runtime.inspect must not invoke a provider tool");
		},
		settings: Settings.isolated(),
	};
}

afterAll(async () => {
	await Promise.all([disposeAllVmContexts(), disposeAllKernelSessions()]);
});

describe("runtime.inspect", () => {
	for (const language of ["js", "py"] as const) {
		it(`returns the host telemetry snapshot in the actual ${language} kernel`, async () => {
			const toolSession = session(() => telemetry);
			const result =
				language === "js"
					? await executeJs("console.log(JSON.stringify(await runtime.inspect()))", {
							sessionId: `runtime-inspect-${language}`,
							session: toolSession,
						})
					: await executePython("import json\nprint(json.dumps(runtime.inspect()))", {
							sessionId: `runtime-inspect-${language}`,
							toolSession,
						});

			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.output.trim())).toEqual(telemetry);
		});

		it(`returns explicit null when telemetry is unavailable in ${language}`, async () => {
			const toolSession = session(undefined);
			const code =
				language === "js"
					? "console.log(JSON.stringify(await runtime.inspect()))"
					: "import json\nprint(json.dumps(runtime.inspect()))";
			const result =
				language === "js"
					? await executeJs(code, { sessionId: `runtime-inspect-empty-${language}`, session: toolSession })
					: await executePython(code, { sessionId: `runtime-inspect-empty-${language}`, toolSession });

			expect(result.exitCode).toBe(0);
			expect(result.output.trim()).toBe("null");
		});
	}
});
