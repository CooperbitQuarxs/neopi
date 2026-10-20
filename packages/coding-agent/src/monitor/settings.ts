/**
 * Tmux agent monitor settings (#345).
 *
 * The monitor is opt-in: `/monitor on` starts it for the current session, and
 * `monitor.tmux.autoStart` starts it whenever an interactive session opens
 * inside tmux. It always uses its own tmux session on the owner's tmux server.
 */
import { type AnySetting, combine, register } from "../config/registry";
import type { Settings } from "../config/settings";
import { DEFAULT_MONITOR_LAYOUT, type MonitorLayoutConfig } from "./layout";

export const cfgMonitorAutoStart = register({
	id: "monitor.tmux.autoStart",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Start the tmux agent monitor",
		description:
			"Open a dedicated tmux session with one live pane per subagent and advisor whenever a session starts inside tmux",
	},
});

export const cfgMonitorIncludeAdvisors = register({
	id: "monitor.tmux.includeAdvisors",
	type: "boolean",
	default: true,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor advisors",
		description: "Give advisors their own read-only monitor panes",
	},
});

/** Counts and dimensions are strings so the registry can expose a named sentinel and free text. */
function validateDimension(value: unknown, sentinel: "infinite" | "dynamic"): void {
	if (value === undefined) return;
	if (
		typeof value === "string" &&
		(value === sentinel || (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))))
	) {
		return;
	}
	throw new Error(`Use a positive safe integer or "${sentinel}"`);
}

export const cfgMonitorMaxRows = register({
	id: "monitor.tmux.maxRows",
	type: "string",
	default: String(DEFAULT_MONITOR_LAYOUT.maxRows),
	validate: value => validateDimension(value, "infinite"),
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Maximum monitor rows",
		description: 'Positive integer or "infinite". Default: 2. Restart the monitor to redistribute existing panes',
	},
});

export const cfgMonitorMaxColumns = register({
	id: "monitor.tmux.maxColumns",
	type: "string",
	default: String(DEFAULT_MONITOR_LAYOUT.maxColumns),
	validate: value => validateDimension(value, "infinite"),
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Maximum monitor columns",
		description: 'Positive integer or "infinite" (default). A new window opens only when both finite limits are full',
	},
});

export const cfgMonitorFillOrder = register({
	id: "monitor.tmux.fillOrder",
	type: "enum",
	values: ["rows-first", "columns-first"],
	default: DEFAULT_MONITOR_LAYOUT.fillOrder,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor fill order",
		description:
			"Fill rows down each column first, or columns across each row first; also chooses the first alternate growth axis",
		options: [
			{ value: "rows-first", label: "Rows first", description: "Fill a column before moving to the next column" },
			{ value: "columns-first", label: "Columns first", description: "Fill a row before moving to the next row" },
		],
	},
});

export const cfgMonitorGrowth = register({
	id: "monitor.tmux.growth",
	type: "enum",
	values: ["fallback", "alternate"],
	default: DEFAULT_MONITOR_LAYOUT.growth,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor growth",
		description:
			"Alternate takes effect when both counts are infinite: fill each new edge before growing the other axis",
		options: [
			{
				value: "fallback",
				label: "Fallback",
				description: "Switch axis only when the preferred finite count is full",
			},
			{
				value: "alternate",
				label: "Alternate",
				description: "With both counts infinite, alternate complete rows and columns",
			},
		],
	},
});

export const cfgMonitorDirection = register({
	id: "monitor.tmux.direction",
	type: "enum",
	values: ["down-right", "up-left"],
	default: DEFAULT_MONITOR_LAYOUT.direction,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor growth direction",
		description: "Grow down and right, or mirror placement to grow up and left",
		options: [
			{ value: "down-right", label: "Down and right" },
			{ value: "up-left", label: "Up and left" },
		],
	},
});

export const cfgMonitorRowHeight = register({
	id: "monitor.tmux.rowHeight",
	type: "string",
	default: String(DEFAULT_MONITOR_LAYOUT.rowHeight),
	validate: value => validateDimension(value, "dynamic"),
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor row height",
		description: 'Positive integer in terminal cells, or "dynamic" (default) to equalize row heights',
	},
});

export const cfgMonitorColumnWidth = register({
	id: "monitor.tmux.columnWidth",
	type: "string",
	default: String(DEFAULT_MONITOR_LAYOUT.columnWidth),
	validate: value => validateDimension(value, "dynamic"),
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor column width",
		description: 'Positive integer in terminal cells, or "dynamic" (default) to equalize column widths',
	},
});

const monitorLayout = combine(
	{
		maxRows: cfgMonitorMaxRows,
		maxColumns: cfgMonitorMaxColumns,
		fillOrder: cfgMonitorFillOrder,
		growth: cfgMonitorGrowth,
		direction: cfgMonitorDirection,
		rowHeight: cfgMonitorRowHeight,
		columnWidth: cfgMonitorColumnWidth,
	},
	(values): MonitorLayoutConfig => ({
		...values,
		maxRows: values.maxRows === "infinite" ? "infinite" : Number(values.maxRows),
		maxColumns: values.maxColumns === "infinite" ? "infinite" : Number(values.maxColumns),
		rowHeight: values.rowHeight === "dynamic" ? "dynamic" : Number(values.rowHeight),
		columnWidth: values.columnWidth === "dynamic" ? "dynamic" : Number(values.columnWidth),
	}),
);

export function readMonitorLayout(settings: Settings): MonitorLayoutConfig {
	return monitorLayout.get(settings);
}

/** Shared registry handles for the focused `/monitor configure` menu. */
export const MONITOR_SETTINGS: readonly AnySetting[] = [
	cfgMonitorAutoStart,
	cfgMonitorIncludeAdvisors,
	cfgMonitorMaxRows,
	cfgMonitorMaxColumns,
	cfgMonitorFillOrder,
	cfgMonitorGrowth,
	cfgMonitorDirection,
	cfgMonitorRowHeight,
	cfgMonitorColumnWidth,
];
