import { expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import type { InteractiveModeContext } from "../../src/modes/types";
import { configureAgentMonitor } from "../../src/monitor/configure";
import { DEFAULT_MONITOR_LAYOUT } from "../../src/monitor/layout";
import {
	cfgMonitorColumnWidth,
	cfgMonitorMaxColumns,
	cfgMonitorMaxRows,
	cfgMonitorRowHeight,
	readMonitorLayout,
} from "../../src/monitor/settings";

it("reads default layout and converts arbitrary custom counts and independent dimensions", () => {
	const settings = Settings.isolated();
	expect(readMonitorLayout(settings)).toEqual(DEFAULT_MONITOR_LAYOUT);
	cfgMonitorMaxRows.override(settings, "17");
	cfgMonitorMaxColumns.override(settings, "93");
	cfgMonitorRowHeight.override(settings, "12");
	cfgMonitorColumnWidth.override(settings, "107");
	expect(readMonitorLayout(settings)).toEqual({
		...DEFAULT_MONITOR_LAYOUT,
		maxRows: 17,
		maxColumns: 93,
		rowHeight: 12,
		columnWidth: 107,
	});
	cfgMonitorMaxRows.override(settings, "infinite");
	cfgMonitorRowHeight.override(settings, "dynamic");
	expect(readMonitorLayout(settings).maxRows).toBe("infinite");
	expect(readMonitorLayout(settings).rowHeight).toBe("dynamic");
});

it("rejects nonpositive, fractional, unsafe, and wrong-sentinel custom fields without changing settings", () => {
	const settings = Settings.isolated();
	for (const field of [cfgMonitorMaxRows, cfgMonitorMaxColumns, cfgMonitorRowHeight, cfgMonitorColumnWidth]) {
		for (const value of ["0", "-1", "1.5", "9007199254740992", "", "NaN"]) {
			expect(() => field.override(settings, value)).toThrow();
		}
	}
	expect(() => cfgMonitorMaxRows.override(settings, "dynamic")).toThrow();
	expect(() => cfgMonitorColumnWidth.override(settings, "infinite")).toThrow();
	expect(readMonitorLayout(settings)).toEqual(DEFAULT_MONITOR_LAYOUT);
});

it("configures presets, custom values and sentinels through the monitor menu", async () => {
	const settings = Settings.isolated();
	const errors: string[] = [];
	const steps = [
		{ field: "Maximum monitor rows", value: "Custom…", input: "19" },
		{ field: "Maximum monitor columns", value: "infinite" },
		{ field: "Monitor row height", value: "Custom…", input: "23" },
		{ field: "Monitor column width", value: "Custom…", input: "97" },
		{ field: "Monitor fill order", value: "Columns first" },
		{ field: "Monitor growth", value: "Alternate" },
		{ field: "Monitor growth direction", value: "Up and left" },
	];
	let index = 0;
	const ctx = {
		settings,
		showError: (message: string) => errors.push(message),
		getToolUIContext: () => ({
			select: async (title: string, choices: Array<{ label: string }>) => {
				const step = steps[index];
				if (!step) return undefined;
				if (title.startsWith("Agent monitor"))
					return choices.find(choice => choice.label.startsWith(`${step.field} ·`))?.label;
				if (!step.input) index++;
				return step.value;
			},
			input: async () => steps[index++]?.input,
		}),
	} as unknown as InteractiveModeContext;
	await configureAgentMonitor(ctx);
	expect(index).toBe(steps.length);
	expect(errors).toEqual([]);
	expect(readMonitorLayout(settings)).toEqual({
		maxRows: 19,
		maxColumns: "infinite",
		rowHeight: 23,
		columnWidth: 97,
		fillOrder: "columns-first",
		growth: "alternate",
		direction: "up-left",
	});
});
