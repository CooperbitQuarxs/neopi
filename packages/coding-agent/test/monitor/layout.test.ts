import { expect, it } from "bun:test";
import { DEFAULT_MONITOR_LAYOUT, monitorWindowCapacity, planMonitorLayout } from "../../src/monitor/layout";

it("fills two rows before starting each new column, equalizing all six panes", () => {
	const plan = planMonitorLayout(["%1", "%2", "%3", "%4", "%5", "%6"], DEFAULT_MONITOR_LAYOUT, 122, 41);
	expect(plan.panes).toEqual([
		{ id: "%1", x: 0, y: 0, width: 40, height: 20 },
		{ id: "%2", x: 0, y: 21, width: 40, height: 20 },
		{ id: "%3", x: 41, y: 0, width: 40, height: 20 },
		{ id: "%4", x: 41, y: 21, width: 40, height: 20 },
		{ id: "%5", x: 82, y: 0, width: 40, height: 20 },
		{ id: "%6", x: 82, y: 21, width: 40, height: 20 },
	]);
});

it("alternates completed edges rather than alternating every pane", () => {
	const plan = planMonitorLayout(["%1", "%2", "%3", "%4", "%5", "%6", "%7"], {
		...DEFAULT_MONITOR_LAYOUT, maxRows: "infinite", growth: "alternate",
	}, 122, 62);
	expect(plan.panes).toEqual([
		{ id: "%1", x: 0, y: 0, width: 40, height: 20 },
		{ id: "%2", x: 0, y: 21, width: 40, height: 20 },
		{ id: "%3", x: 41, y: 0, width: 40, height: 20 },
		{ id: "%4", x: 41, y: 21, width: 40, height: 20 },
		{ id: "%5", x: 0, y: 42, width: 40, height: 20 },
		{ id: "%6", x: 41, y: 42, width: 40, height: 20 },
		{ id: "%7", x: 82, y: 0, width: 40, height: 62 },
	]);
});

it("mirrors columns-first placement while holding both cell dimensions fixed", () => {
	const plan = planMonitorLayout(["%1", "%2", "%3", "%4"], {
		...DEFAULT_MONITOR_LAYOUT, maxColumns: 2, fillOrder: "columns-first",
		direction: "up-left", rowHeight: 10, columnWidth: 30,
	}, 200, 100);
	expect([plan.width, plan.height]).toEqual([61, 21]);
	expect(plan.panes).toEqual([
		{ id: "%1", x: 31, y: 11, width: 30, height: 10 },
		{ id: "%2", x: 0, y: 11, width: 30, height: 10 },
		{ id: "%3", x: 31, y: 0, width: 30, height: 10 },
		{ id: "%4", x: 0, y: 0, width: 30, height: 10 },
	]);
});

it("overflows only when both finite counts are full", () => {
	expect(monitorWindowCapacity(DEFAULT_MONITOR_LAYOUT)).toBe(Infinity);
	expect(monitorWindowCapacity({ ...DEFAULT_MONITOR_LAYOUT, maxRows: "infinite", maxColumns: 2 })).toBe(Infinity);
	const bounded = { ...DEFAULT_MONITOR_LAYOUT, maxRows: 2, maxColumns: 3 };
	expect(monitorWindowCapacity(bounded)).toBe(6);
	expect(() => planMonitorLayout(["%1", "%2", "%3", "%4", "%5", "%6", "%7"], bounded, 120, 40)).toThrow("capacity");
});

it("rejects invalid numeric limits rather than hanging or creating zero-sized cells", () => {
	for (const maxRows of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
		expect(() => monitorWindowCapacity({ ...DEFAULT_MONITOR_LAYOUT, maxRows })).toThrow("positive");
	}
	expect(() => planMonitorLayout(["%1"], { ...DEFAULT_MONITOR_LAYOUT, rowHeight: 0 }, 80, 24)).toThrow("positive");
});

it("supports full-height columns and the transposed fixed-column stack", () => {
	const columns = planMonitorLayout(["%1", "%2", "%3"], { ...DEFAULT_MONITOR_LAYOUT, maxRows: 1 }, 122, 41);
	expect(columns.panes.map(pane => [pane.x, pane.y, pane.width, pane.height])).toEqual([
		[0, 0, 40, 41], [41, 0, 40, 41], [82, 0, 40, 41],
	]);
	const rows = planMonitorLayout(["%1", "%2", "%3"], {
		...DEFAULT_MONITOR_LAYOUT, maxRows: "infinite", maxColumns: 1, fillOrder: "columns-first",
	}, 122, 62);
	expect(rows.panes.map(pane => [pane.x, pane.y, pane.width, pane.height])).toEqual([
		[0, 0, 122, 20], [0, 21, 122, 20], [0, 42, 122, 20],
	]);
});

it("leaves an infinite preferred axis unbounded in fallback mode", () => {
	const plan = planMonitorLayout(["%1", "%2", "%3"], {
		...DEFAULT_MONITOR_LAYOUT, maxRows: "infinite",
	}, 122, 62);
	expect(plan.panes.map(pane => [pane.x, pane.y])).toEqual([[0, 0], [0, 21], [0, 42]]);
});

it("starts alternate growth with columns when requested and can fix just one sizing axis", () => {
	const plan = planMonitorLayout(["%1", "%2", "%3", "%4", "%5", "%6"], {
		...DEFAULT_MONITOR_LAYOUT, maxRows: "infinite", growth: "alternate", fillOrder: "columns-first", rowHeight: 10,
	}, 122, 100);
	expect([plan.width, plan.height]).toEqual([122, 21]);
	expect(plan.panes.map(pane => [pane.x, pane.y])).toEqual([
		[0, 0], [41, 0], [0, 11], [41, 11], [82, 0], [82, 11],
	]);
	expect(plan.panes.map(pane => pane.height)).toEqual([10, 10, 10, 10, 10, 10]);
});

it("reserves the tmux top title without subtracting it from fixed transcript heights", () => {
	const plan = planMonitorLayout(["%1", "%2"], {
		...DEFAULT_MONITOR_LAYOUT, rowHeight: 12, columnWidth: 40,
	}, 80, 40, true);
	expect([plan.width, plan.height]).toEqual([40, 26]);
	expect(plan.panes).toEqual([
		{ id: "%1", x: 0, y: 1, width: 40, height: 12 },
		{ id: "%2", x: 0, y: 14, width: 40, height: 12 },
	]);
});
