import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	cfgTelemetryAgentContext,
	cfgTelemetryThresholdEvents,
	cfgTelemetryToolResults,
} from "@oh-my-pi/pi-coding-agent/telemetry-settings";

describe("local agent telemetry settings", () => {
	it("keeps all automatic telemetry disabled by default", () => {
		const settings = Settings.isolated();
		expect(cfgTelemetryAgentContext.get(settings)).toBe("off");
		expect(cfgTelemetryToolResults.get(settings)).toBe("off");
		expect(cfgTelemetryThresholdEvents.get(settings)).toBe(false);
	});

	it.each(["off", "minimal", "full"] as const)("accepts context mode %s without enabling result injection", mode => {
		const settings = Settings.isolated({ "telemetry.agent_context": mode });
		expect(cfgTelemetryAgentContext.get(settings)).toBe(mode);
		expect(cfgTelemetryToolResults.get(settings)).toBe("off");
		expect(cfgTelemetryThresholdEvents.get(settings)).toBe(false);
	});

	it.each(["off", "summary", "full"] as const)("accepts tool-result mode %s independently of context injection", mode => {
		const settings = Settings.isolated({ "telemetry.tool_results": mode });
		expect(cfgTelemetryToolResults.get(settings)).toBe(mode);
		expect(cfgTelemetryAgentContext.get(settings)).toBe("off");
	});

	it("enables threshold notices without changing either detail mode", () => {
		const settings = Settings.isolated({ "telemetry.threshold_events": true });
		expect(cfgTelemetryThresholdEvents.get(settings)).toBe(true);
		expect(cfgTelemetryAgentContext.get(settings)).toBe("off");
		expect(cfgTelemetryToolResults.get(settings)).toBe("off");
	});
});
