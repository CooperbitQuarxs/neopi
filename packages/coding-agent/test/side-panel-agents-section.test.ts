import { beforeAll, describe, expect, it } from "bun:test";
import { AgentsSection } from "@oh-my-pi/pi-coding-agent/modes/side-panel/agents-section";
import { parseSgrMouse, type SgrMouseEvent } from "@oh-my-pi/pi-tui";
import { SidePanel } from "@oh-my-pi/pi-tui/chrome";
import type { AgentRecordLike } from "@oh-my-pi/pi-tui/overlays/agent-hub-types";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

function ref(id: string, overrides: Partial<AgentRecordLike> = {}): AgentRecordLike {
	return {
		id,
		displayName: id,
		kind: "sub",
		status: "running",
		session: null,
		sessionFile: null,
		createdAt: 0,
		lastActivity: 0,
		...overrides,
	};
}

function event(report: string): SgrMouseEvent {
	const parsed = parseSgrMouse(report);
	if (!parsed) throw new Error("bad report");
	return parsed;
}

const leftClick = event("\x1b[<0;2;1M");
const motion = event("\x1b[<35;2;1M");

/** An Agents section in a real SidePanel, with the host's calls recorded. */
function harness(agents: AgentRecordLike[]) {
	const calls: string[] = [];
	let focused: string | undefined;
	let renders = 0;
	const section = new AgentsSection({
		agents: () => agents,
		focusedAgentId: () => focused,
		focus: id => {
			calls.push(`focus ${id}`);
			focused = id;
		},
		returnToPrimary: () => {
			calls.push("primary");
			focused = undefined;
		},
		requestRender: () => {
			renders++;
		},
		onChange: () => () => {},
	});
	const panel = new SidePanel({ onEmptyClick: () => section.clickEmpty() });
	panel.register(section);
	panel.setHeight(10);
	const render = () => panel.render(40).map(line => Bun.stripANSI(line));
	render();
	return { panel, calls, render, renders: () => renders };
}

beforeAll(async () => {
	await initTheme();
});

describe("AgentsSection", () => {
	it("lists subagents and read-only advisors in spawn order, whatever their status, and nothing else", () => {
		const agents = [
			ref("Runner", { createdAt: 2 }),
			ref("Parked", { status: "parked", createdAt: 1 }),
			ref("Advisor", { kind: "advisor", status: "idle", createdAt: 3 }),
			ref("Main", { kind: "main" }),
			ref("Operator", { kind: "operator" }),
		];
		const h = harness(agents);
		const order = () => {
			const rows = h.render();
			return ["Parked", "Runner", "Advisor"].map(id => rows.findIndex(row => row.includes(id)));
		};
		expect(order()).toEqual([1, 2, 3]);
		expect(h.render()[3]).toContain("read-only");
		expect(h.render().some(row => row.includes("Main") || row.includes("Operator"))).toBe(false);
		// Reviving the parked agent does not move its row under the pointer.
		agents[1] = ref("Parked", { status: "running", createdAt: 1 });
		expect(order()).toEqual([1, 2, 3]);
	});

	it("shows the agent clicked in the main area and returns to the primary on a second click or empty space", () => {
		const h = harness([ref("Runner"), ref("Other", { createdAt: 1 })]);
		// Row 0 is the title; agent rows follow in order.
		h.panel.routeMouse(leftClick, 1, 2);
		expect(h.calls).toEqual(["focus Runner"]);
		h.panel.routeMouse(leftClick, 1, 2);
		expect(h.calls).toEqual(["focus Runner", "primary"]);
		h.panel.routeMouse(leftClick, 2, 2);
		h.render();
		// Far below the document is empty panel space.
		h.panel.routeMouse(leftClick, 9, 2);
		expect(h.calls).toEqual(["focus Runner", "primary", "focus Other", "primary"]);
		// Empty space while the primary is shown does nothing.
		h.panel.routeMouse(leftClick, 9, 2);
		expect(h.calls).toHaveLength(4);
	});

	it("repaints only when the hovered row changes and drops the hover when the pointer leaves", () => {
		const h = harness([ref("Runner")]);
		const before = h.renders();
		h.panel.routeMouse(motion, 1, 2);
		h.panel.routeMouse(motion, 1, 3);
		expect(h.renders()).toBe(before + 1);
		h.panel.pointerLeave();
		expect(h.renders()).toBe(before + 2);
		h.panel.pointerLeave();
		expect(h.renders()).toBe(before + 2);
	});

	it("renders nothing without agents, so the panel shows its placeholder", () => {
		const h = harness([]);
		expect(h.render()[0]).toContain("nothing to show");
	});
});
