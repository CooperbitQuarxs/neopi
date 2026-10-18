import { beforeAll, describe, expect, it } from "bun:test";
import type { UsageReport } from "@oh-my-pi/pi-ai/usage";
import {
	describeSegment,
	parseUsageBarTemplate,
	renderSegment,
	USAGE_BAR_TEMPLATE_MAX_LENGTH,
	type SegmentContext,
} from "../src/status-line/segments";
import { initTheme, theme } from "../src/theme";
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

	it("keeps the entire loading or unavailable bar dim in both render paths", () => {
		for (const [id, ctx, expected] of [
			["usage:anthropic:5h", context(null), "AN 5h …"],
			["usage:anthropic:5h", context({ reports: [] }), "AN 5h n/a"],
			["usage:kimi-code:5h", context({ reports }), "kimi-code 5h n/a"],
		] as const) {
			expect(renderSegment(id, ctx)).toEqual({ content: theme.fg("dim", expected), visible: true });
			expect(describeSegment(id, ctx)).toEqual({ spans: [{ t: expected, s: "dim" }] });
		}
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

	it("keeps escaped, unknown, and unclosed placeholders literal", () => {
		for (const [template, expected] of [
			["{{/}} {{percent}} {{{percent}}}", "{/} {percent} {10%}"],
			["{{x}} {percent} {constructor} {age", "{x} 10% {constructor} {age"],
			["{unknown}} {percent}", "{unknown}} 10%"],
			["{unknown{percent}} {label}", "{unknown{percent}} AN 5h"],
			["{age {percent}", "{age {percent}"],
			["} {percent}", "} 10%"],
		] as const) {
			const ctx = context({ reports }, { "usage:anthropic:5h": template });
			expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe(expected);
			expect(
				describeSegment("usage:anthropic:5h", ctx)
					?.spans.map(part => part.t)
					.join(""),
			).toBe(expected);
		}
	});

	it("sanitizes terminal controls and malformed Unicode before theming", () => {
		const ctx = context(
			{ reports },
			{ "usage:anthropic:5h": "{percent}\n\x1b]0;title\x07\x1b[31mX\tY\u0000Z\uD800" },
		);
		const content = renderSegment("usage:anthropic:5h", ctx).content;
		expect(Bun.stripANSI(content)).toBe("10% X YZ");
		expect(content).not.toContain("\n");
		expect(content).not.toContain("\x1b]");
		expect(
			describeSegment("usage:anthropic:5h", ctx)
				?.spans.map(part => part.t)
				.join(""),
		).toBe("10% X YZ");
	});

	it("strips whole escape sequences before limiting template width", () => {
		const ctx = context(
			{ reports },
			{ "usage:anthropic:5h": `\x1b]0;${"title".repeat(USAGE_BAR_TEMPLATE_MAX_LENGTH)}\x07{percent}` },
		);
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe("10%");
		expect(describeSegment("usage:anthropic:5h", ctx)).toEqual({ spans: [{ t: "10%", s: "muted" }] });
	});

	it("limits source width without cutting a surrogate pair", () => {
		for (const [template, expected] of [
			[
				"x".repeat(USAGE_BAR_TEMPLATE_MAX_LENGTH - 1) + "\u{20000}",
				"x".repeat(USAGE_BAR_TEMPLATE_MAX_LENGTH - 1),
			],
			[
				"x".repeat(USAGE_BAR_TEMPLATE_MAX_LENGTH - 2) + "\u{20000}Z",
				"x".repeat(USAGE_BAR_TEMPLATE_MAX_LENGTH - 2) + "\u{20000}",
			],
		] as const) {
			const ctx = context({ reports }, { "usage:anthropic:5h": template });
			expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe(expected);
			expect(describeSegment("usage:anthropic:5h", ctx)).toEqual({ spans: [{ t: expected }] });
		}
	});

	it("collapses spaces around missing ages without joining adjacent words", () => {
		for (const [template, expected] of [
			["{label} {percent} {age} left", "AN 5h … left"],
			["{label} {age}{percent}", "AN 5h …"],
			["{age} {age} {label} {age} {percent} {age}", "AN 5h …"],
			["{percent} {age}left", "… left"],
		] as const) {
			const ctx = context(null, { "usage:anthropic:5h": template });
			expect(renderSegment("usage:anthropic:5h", ctx)).toEqual({
				content: theme.fg("dim", expected),
				visible: true,
			});
			expect(describeSegment("usage:anthropic:5h", ctx)).toEqual({ spans: [{ t: expected, s: "dim" }] });
		}
	});

	it("does not mutate cached templates when ages disappear or template text changes", () => {
		const templates = { "usage:anthropic:5h": "{percent} {age}" };
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", context(null, templates)).content)).toBe("…");
		const ctx = context({ reports }, templates);
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe("10% 2m");
		templates["usage:anthropic:5h"] = "used {percent}";
		expect(Bun.stripANSI(renderSegment("usage:anthropic:5h", ctx).content)).toBe("used 10%");
		expect(parseUsageBarTemplate("{percent} {age}")).toEqual([
			{ token: "percent" },
			{ text: " " },
			{ token: "age" },
		]);
	});

	it("hides empty templates consistently instead of emitting an empty native segment", () => {
		for (const template of ["", " \n\t ", "{age} {age}"]) {
			const ctx = context(null, { "usage:anthropic:5h": template });
			expect(renderSegment("usage:anthropic:5h", ctx)).toEqual({ content: "", visible: false });
			expect(describeSegment("usage:anthropic:5h", ctx)).toBeNull();
		}
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
