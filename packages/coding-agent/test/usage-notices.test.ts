import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { USAGE_REPORT_TTL_MS } from "@oh-my-pi/pi-ai/auth/sqlite-credential-store";
import type { UsageReport } from "@oh-my-pi/pi-ai/usage";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AgentContextTelemetry } from "@oh-my-pi/pi-coding-agent/session/agent-telemetry";
import { UsageNotices, type UsageNotice } from "@oh-my-pi/pi-coding-agent/session/usage-notices";

const now = 1_800_000_000_000;
function report(used = 0.85, reset = now + 100_000): UsageReport {
	return {
		provider: "test",
		fetchedAt: now - 10_000,
		limits: [
			{
				id: "5h",
				label: "5 hours",
				scope: { provider: "test", accountId: "account" },
				window: { id: "5h", label: "5 hours", resetsAt: reset },
				amount: { usedFraction: used, unit: "percent" },
			},
		],
	};
}
function fixture(values: Record<string, unknown> = {}) {
	const settings = Settings.isolated({ "usageNotices.enabled": true, ...values });
	const controller = new UsageNotices();
	const emitted: UsageNotice[] = [];
	const context: AgentContextTelemetry = {
		type: "agent_context",
		model: { provider: "test", id: "model", effort: null },
		context: { usedTokens: 20_000, limitTokens: 100_000, percent: 20, estimated: true },
		compaction: { enabled: true, thresholdTokens: 85_000, speculationStartsAtTokens: 75_000, state: "idle" },
		checkpoint: { active: false },
		previousTurn: null,
		fleet: { running: 0, idle: 0, parked: 0, aborted: 0 },
	};
	const messages: AgentMessage[] = [{ role: "user", content: "continue", timestamp: now }];
	let reads = 0;
	let reports: UsageReport[] | null = [report()];
	const prepare = (time = now) =>
		controller.prepare(
			messages,
			settings,
			() => context,
			async () => {
				reads++;
				return reports;
			},
			event => emitted.push(event),
			time,
		);
	return {
		settings,
		controller,
		emitted,
		context,
		messages,
		prepare,
		reads: () => reads,
		reports: (next: UsageReport[] | null) => {
			reports = next;
		},
	};
}

describe("usage and context threshold notices", () => {
	it("does not inspect or fetch anything while switched off", async () => {
		const state = fixture({ "usageNotices.enabled": false, "telemetry.threshold_events": true });
		expect(await state.prepare()).toBe(state.messages);
		expect(state.reads()).toBe(0);
		expect(state.emitted).toEqual([]);
	});

	it("shows human quota notices with reset and age but never injects without telemetry consent", async () => {
		const state = fixture({ "telemetry.agent_context": "full" });
		expect(await state.prepare()).toBe(state.messages);
		expect(state.emitted).toHaveLength(1);
		expect(state.emitted[0]).toMatchObject({
			type: "provider_quota",
			provider: "test",
			window: "5 hours",
			usedPercent: 85,
			cacheAgeMs: 10_000,
			resetsAt: now + 100_000,
			stale: false,
		});
		await state.prepare(now + 1_000);
		expect(state.reads()).toBe(1);
		expect(state.emitted).toHaveLength(1);
	});

	it("rearms after recovery and after a new quota reset window", async () => {
		const state = fixture({ "telemetry.threshold_events": true });
		const first = await state.prepare();
		expect(first.at(-1)).toMatchObject({ role: "custom", customType: "agent-usage-notices", display: false });
		expect(JSON.stringify(first)).toContain("usage_threshold_events");
		state.controller.observe([report(0.1)], now + 1);
		await state.prepare(now + 1);
		state.controller.observe([report()], now + 2);
		await state.prepare(now + 2);
		state.controller.observe([report(0.85, now + 200_000)], now + 3);
		await state.prepare(now + 3);
		expect(state.emitted.filter(event => event.type === "provider_quota")).toHaveLength(3);
		expect(state.messages).toHaveLength(1);
	});

	it("supports a separate remaining-window percentage crossing without repeating the used crossing", async () => {
		const state = fixture({ "usageNotices.quotaPercent": 100, "usageNotices.remainingPercent": 20 });
		await state.prepare();
		expect(state.emitted).toHaveLength(1);
		state.controller.observe([report(0.9)], now + 1);
		await state.prepare(now + 1);
		expect(state.emitted).toHaveLength(1);
	});

	it("reports context occupancy, compaction headroom and the boundary delta, then rearms after compaction", async () => {
		const state = fixture();
		await state.prepare();
		state.context.context = { usedTokens: 82_000, limitTokens: 100_000, percent: 82, estimated: true };
		await state.prepare(now + 1);
		expect(state.emitted.at(-1)).toMatchObject({
			type: "context_pressure",
			usedPercent: 82,
			compactionThresholdTokens: 85_000,
			headroomTokens: 3_000,
			deltaTokens: 62_000,
			estimated: true,
		});
		await state.prepare(now + 2);
		expect(state.emitted.filter(event => event.type === "context_pressure")).toHaveLength(1);
		state.context.context.percent = 10;
		state.context.context.usedTokens = 10_000;
		await state.prepare(now + 3);
		state.context.context.percent = 85;
		state.context.context.usedTokens = 85_000;
		await state.prepare(now + 4);
		expect(state.emitted.filter(event => event.type === "context_pressure")).toHaveLength(2);
	});

	it("uses the existing TTL cadence and reports missing and stale usage without retrying faster", async () => {
		const state = fixture();
		state.reports(null);
		await state.prepare();
		expect(state.emitted[0]).toMatchObject({ type: "usage_unavailable", cacheAgeMs: null });
		await state.prepare(now + USAGE_REPORT_TTL_MS - 1);
		expect(state.reads()).toBe(1);
		state.reports([report()]);
		await state.prepare(now + USAGE_REPORT_TTL_MS);
		expect(state.reads()).toBe(2);
		expect(state.emitted).toContainEqual(
			expect.objectContaining({ type: "usage_unavailable", stale: true, cacheAgeMs: USAGE_REPORT_TTL_MS + 10_000 }),
		);
	});

	it("turns fetch failures into notices rather than failing the model request", async () => {
		const state = fixture({ "telemetry.threshold_events": true });
		const projected = await state.controller.prepare(
			state.messages,
			state.settings,
			() => state.context,
			async () => {
				throw new Error("broker unavailable");
			},
			event => state.emitted.push(event),
			now,
		);
		expect(projected).toHaveLength(2);
		expect(state.emitted[0]!.type).toBe("usage_unavailable");
	});
});
