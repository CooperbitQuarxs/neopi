import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { registerPersistedSubagents } from "@oh-my-pi/pi-coding-agent/registry/persisted-agents";
import { TempDir } from "@oh-my-pi/pi-utils";

function assistant(
	id: string,
	parentId: string,
	usage: Record<string, unknown>,
	timing: { ttft?: number; duration?: number },
): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: "2026-08-07T11:00:00.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			provider: "anthropic",
			model: "claude-sonnet-5",
			stopReason: "stop",
			usage,
			...timing,
		},
	});
}

describe("persisted agent usage record", () => {
	it("splits tokens by bucket and reports the newest request's timing", async () => {
		using tempDir = TempDir.createSync("@omp-persisted-usage-");
		const dir = tempDir.path();
		await Bun.write(path.join(dir, "main.jsonl"), "");
		await Bun.write(
			path.join(dir, "main", "Worker.jsonl"),
			`${[
				JSON.stringify({ type: "session", id: "s0", parentId: null, timestamp: "2026-08-07T10:34:37.300Z" }),
				assistant(
					"a1",
					"s0",
					{ input: 10, output: 20, reasoningTokens: 5, cacheRead: 100, totalTokens: 130, cost: { total: 0.25 } },
					{ ttft: 900, duration: 2000 },
				),
				assistant(
					"a2",
					"a1",
					{ input: 15, output: 50, cacheWrite: 40, totalTokens: 105, cost: { total: 0.5 } },
					{ ttft: 300, duration: 1000 },
				),
			].join("\n")}\n`,
		);
		const registry = new AgentRegistry();
		await registerPersistedSubagents(registry, path.join(dir, "main.jsonl"));

		const usage = registry.get("Worker")?.history?.metrics?.agentUsage;
		expect(usage).toMatchObject({
			input: 25,
			output: 70,
			reasoning: 5,
			cacheRead: 100,
			cacheWrite: 40,
			total: 235,
			cost: 0.75,
			requests: 2,
		});
		// The scan walks leaf → root; the timing must still be the newest request's.
		expect(usage?.last).toEqual({ ttftMs: 300, durationMs: 1000, outputTokensPerSecond: 50 });
	});
});
