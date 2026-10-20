/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "./config/registry";

/** Whether OMP may register process-global OTLP exporters. */
export const cfgTelemetryOtlpExportEnabled = register({
	id: "telemetry.otlpExportEnabled",
	type: "boolean",
	default: true,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "OTLP Telemetry Export",
		description:
			"Allow OMP to export traces, logs, and metrics using OTEL_* endpoints. Changes take effect on the next launch.",
	},
});

/** Local context telemetry exposed to the running agent. */
export const cfgTelemetryAgentContext = register({
	id: "telemetry.agent_context",
	type: "enum",
	values: ["off", "minimal", "full"],
	default: "off",
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Agent Context Telemetry",
		description: "Local context usage and headroom: off, minimal totals, or full breakdown. Disabled by default.",
	},
});

/** Tool-result telemetry is independently opt-in. */
export const cfgTelemetryToolResults = register({
	id: "telemetry.tool_results",
	type: "enum",
	values: ["off", "summary", "full"],
	default: "off",
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Tool Result Telemetry",
		description: "Include no tool-result telemetry, a summary, or full details independently of context telemetry.",
	},
});

/** Whether threshold notices may be supplied to the agent. */
export const cfgTelemetryThresholdEvents = register({
	id: "telemetry.threshold_events",
	type: "boolean",
	default: false,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Agent Threshold Notices",
		description: "Notify the agent when compaction approaches or enabled usage notices cross a threshold.",
	},
});

export const cfgUsageNoticesEnabled = register({
	id: "usageNotices.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Usage and Context Notices",
		description: "Show quota and context-pressure crossings. Uses cached usage without forcing refreshes.",
	},
});

export const cfgUsageNoticesQuotaPercent = register({
	id: "usageNotices.quotaPercent",
	type: "number",
	default: 80,
	validate: validatePercent,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Quota Notice Threshold",
		description: "Notify when used quota reaches this percent.",
		options: [50, 70, 80, 90, 95, 100].map(value => ({ value: String(value), label: `${value}%` })),
	},
});

export const cfgUsageNoticesRemainingPercent = register({
	id: "usageNotices.remainingPercent",
	type: "number",
	default: 10,
	validate: validatePercent,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Remaining Quota Notice Threshold",
		description: "Also notify when a quota window has this percent or less remaining.",
		options: [0, 5, 10, 20, 30, 50].map(value => ({ value: String(value), label: `${value}%` })),
	},
});

export const cfgUsageNoticesContextPercent = register({
	id: "usageNotices.contextPercent",
	type: "number",
	default: 80,
	validate: validatePercent,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Context Notice Threshold",
		description: "Notify when estimated context occupancy reaches this percent.",
		options: [50, 70, 80, 85, 90, 95].map(value => ({ value: String(value), label: `${value}%` })),
	},
});

function validatePercent(value: unknown): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error("Notice thresholds must be between 0 and 100 percent");
	}
}
