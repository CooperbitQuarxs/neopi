import { beforeAll, describe, expect, it } from "bun:test";
import type { UsageReport } from "@oh-my-pi/pi-ai/usage";
import { describeSegment, renderSegment, type SegmentContext } from "../src/status-line/segments";
import { initTheme } from "../src/theme";
import { isStatusLineSegmentId, parseUsageBarSegmentId } from "../src/status-line/schema";

beforeAll(async () => {
	await initTheme();
});

const now = 1_800_000_000_000;
const reports: UsageReport[] = [
	{
		provider: "anthropic",
		fetchedAt: now - 120_000,
		limits: [
			{
				id: "anthropic:5h",
				label: "5 Hour",
				scope: { provider: "anthropic", windowId: "5h" },
				amount: { unit: "percent", usedFraction: 0.1 },
			},
			{
				id: "anthropic:7d",
				label: "Weekly",
				scope: { provider: "anthropic", windowId: "7d" },
				amount: { unit: "percent", usedFraction: 0.1 },
			},
			{
				id: "anthropic:7d:fable",
				label: "Fable",
				scope: { provider: "anthropic", windowId: "7d", tier: " FABLE " },
				amount: { unit: "percent", usedFraction: 0.13 },
			},
		],
	},
	{
		provider: "openai-codex",
		fetchedAt: now - 240_000,
		limits: [
			{
				id: "openai-codex:primary",
				label: "Weekly",
				scope: { provider: "openai-codex", windowId: "7d" },
				amount: { unit: "percent", usedFraction: 0.17 },
			},
		],
	},
];

function context(
	usageReports: { reports: readonly UsageReport[] } | null,
	templates?: Record<string, string>,
): SegmentContext {
	return {
		usageReports,
		now: new Date(now),
		options: templates ? { usageBars: { templates } } : {},
	} as unknown as SegmentContext;
}

describe("provider usage-bar rendering", () => {
	it("renders independent provider windows with the same native content", () => {
		const ctx = context({ reports });
		for (const [id, expected] of [
			["usage:anthropic:5h", "AN 5h 10% 2m"],
			["usage:anthropic:7d", "AN wk 10% 2m"],
			["usage:openai-codex:7d", "OA wk 17% 4m"],
			["usage:anthropic:7d:fable", "Fable 13% 2m"],
		] as const) {
			expect(Bun.stripANSI(renderSegment(id, ctx).content)).toBe(expected);
			expect(
				describeSegment(id, ctx)
					?.spans.map(part => part.t)
					.join(""),
			).toBe(expected);
		}
	});

	it("keeps honest loading and missing placeholders visible", () => {
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", context(null)).content)).toBe("AN 5h …");
		expect(renderSegment("usage:anthropic:5h", context(null)).visible).toBe(true);
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", context({ reports: [] })).content)).toBe("AN 5h n/a");
		expect(Bun.stripANSI(renderSegment("usage:kimi-code:5h", context({ reports })).content)).toBe("kimi-code 5h n/a");
	});

	it("places each bar's values inside its own template, terminal and native alike", () => {
		const ctx = context({ reports }, { "usage:anthropic:5h": "Claude {label}: {percent} used ({age} ago)" });
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe("Claude AN 5h: 10% used (2m ago)");
		expect(
			describeSegment("usage:anthropic:5h", ctx)
				?.spans.map(part => part.t)
				.join(""),
		).toBe("Claude AN 5h: 10% used (2m ago)");
		// A sibling bar without its own template keeps the built-in text.
		expect(Bun.stripANSI(renderSegment("usage:anthropic:7d", ctx).content)).toBe("AN wk 10% 2m");
	});

	it("treats templates as text: escaped braces, unknown names, and no terminal controls", () => {
		const literal = context({ reports }, { "usage:anthropic:5h": "{{x}} {percent} {constructor} {age" });
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", literal).content)).toBe("{x} 10% {constructor} {age");
		const hostile = context({ reports }, { "usage:anthropic:5h": "{percent}\n\x1b]0;title\x07\x1b[31mX" });
		const content = renderSegment("usage:anthropic:5h", hostile).content;
		expect(content).not.toContain("\n");
		expect(content).not.toContain("\x1b]");
		expect(content).not.toContain("\x1b[31m");
	});

	it("drops the separator of a missing age so placeholders stay tidy", () => {
		const ctx = context(null, { "usage:anthropic:5h": "{label} {percent} {age} left" });
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe("AN 5h … left");
	});
});

describe("usage-bar segment identifiers", () => {
	it("accepts provider windows and optional tiers alongside builtins", () => {
		expect(parseUsageBarSegmentId("usage:anthropic:5h")).toEqual({ provider: "anthropic", windowId: "5h" });
		expect(parseUsageBarSegmentId("usage:anthropic:7d:fable")).toEqual({
			provider: "anthropic",
			windowId: "7d",
			tier: "fable",
		});
		expect(isStatusLineSegmentId("usage:openai-codex:7d")).toBe(true);
		expect(isStatusLineSegmentId("context_pct")).toBe(true);
	});

	it("rejects missing parts, extra parts, and unknown builtin names", () => {
		for (const id of [
			"usage:",
			"usage:anthropic",
			"usage::5h",
			"usage:anthropic:",
			"usage:anthropic:7d:",
			"usage:a:b:c:d",
			"unknown",
		]) {
			expect(parseUsageBarSegmentId(id)).toBeUndefined();
			expect(isStatusLineSegmentId(id)).toBe(false);
		}
	});
});
