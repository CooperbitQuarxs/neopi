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

/** Whether context telemetry may emit approaching-compaction notices. */
export const cfgTelemetryThresholdEvents = register({
	id: "telemetry.threshold_events",
	type: "boolean",
	default: false,
	ui: {
		tab: "providers",
		group: "Privacy",
		label: "Context Threshold Notices",
		description: "Notify the agent when compaction approaches, including estimated remaining headroom.",
	},
});
