import { afterEach, expect, it } from "bun:test";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ControlMonitorService } from "../../src/control/monitor-service";
import { DEFAULT_MONITOR_LAYOUT, type MonitorLayoutConfig } from "../../src/monitor/layout";
import { paneClosedMarker, TmuxMonitorManager } from "../../src/monitor/tmux-manager";
import type { AgentRef } from "../../src/registry/agent-registry";

const tmuxPath = Bun.which("tmux");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function runTmux(socket: string, cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn([tmuxPath ?? "tmux", "-L", socket, ...args], {
		cwd,
		env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	return { stdout, exitCode };
}

type Target = AgentRef & { kind: "sub" | "advisor" };

/** The monitor service surface the manager uses, backed by a plain target list. */
class FakeMonitor {
	targetList: Target[] = [];
	readonly #grants = new Map<string, { agentId: string; revoked: boolean }>();
	#next = 0;
	targets(): Target[] {
		return this.targetList;
	}
	grant(agentId: string) {
		const capability = `cap-${++this.#next}`;
		this.#grants.set(capability, { agentId, revoked: false });
		return { capability, agentId, kind: "sub" as const, canChat: true };
	}
	revoke(capability: string): void {
		const grant = this.#grants.get(capability);
		if (grant) grant.revoked = true;
	}
	authenticate(capability: string) {
		const grant = this.#grants.get(capability);
		return grant && !grant.revoked ? grant : undefined;
	}
	revoked(): string[] {
		return [...this.#grants].filter(([, grant]) => grant.revoked).map(([capability]) => capability);
	}
}

function target(id: string, kind: Target["kind"] = "sub"): Target {
	return { id, kind } as Target;
}

async function fixture(layout: Partial<MonitorLayoutConfig> = { maxRows: 2, maxColumns: 1 }) {
	const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "npi-monitor-tmux-")));
	const socket = path.basename(root);
	const tmux = (args: string[]) => runTmux(socket, root, args);
	const seed = await tmux([
		"-f",
		"/dev/null",
		"new-session",
		"-d",
		"-x",
		"122",
		"-y",
		"43",
		"-s",
		"user",
		"sleep",
		"1000",
	]);
	if (seed.exitCode !== 0) throw new Error("private tmux server did not start");
	cleanups.push(async () => {
		await tmux(["kill-server"]);
		await fsp.rm(root, { recursive: true, force: true });
	});
	const monitor = new FakeMonitor();
	/** Capability file of each pane, in creation order. */
	const capabilityFiles: string[] = [];
	const create = () =>
		new TmuxMonitorManager({
			monitor: monitor as unknown as Pick<ControlMonitorService, "targets" | "grant" | "revoke" | "authenticate">,
			// Syncs are driven by refresh(); registry events only schedule the same sync.
			registry: { onChange: () => () => {} },
			instanceId: "0123456789abcdef",
			cwd: root,
			capabilityDir: path.join(root, "caps"),
			paneCommand: file => {
				capabilityFiles.push(file);
				return ["sleep", "1000"];
			},
			placeholderCommand: ["sleep", "1000"],
			includeAdvisors: () => true,
			layout: () => ({ ...DEFAULT_MONITOR_LAYOUT, ...layout }),
			runCli: async (argv, cwd) => runTmux(socket, cwd, argv.slice(1)),
			environment: () => ({ TMUX: socket }),
			pollMs: 60_000,
		});
	const panes = async (): Promise<string[]> =>
		(await tmux(["list-panes", "-a", "-F", "#{session_name} #{window_id} #{pane_id} #{@npi_agent}"])).stdout
			.trim()
			.split("\n");
	return { monitor, create, tmux, panes, root, capabilityFiles };
}

it.skipIf(!tmuxPath)("tiles agent panes, overflows windows, and removes only the pane of a removed agent", async () => {
	const { monitor, create, tmux, panes } = await fixture();
	const manager = create();
	cleanups.push(() => manager.stop());
	monitor.targetList = [target("A"), target("B"), target("C"), target("Main/advisor", "advisor")];
	const status = await manager.start();
	expect(status.sessionName).toBe("npi-monitor-01234567");
	const byAgent = new Map(status.panes.map(pane => [pane.agentId, pane]));
	expect([...byAgent.keys()].sort()).toEqual(["A", "B", "C", "Main/advisor"]);
	// Two panes per window: four agents take two windows of the monitor session.
	expect(new Set(status.panes.map(pane => pane.windowId)).size).toBe(2);
	const userPane = (
		await tmux([
			"split-window",
			"-d",
			"-P",
			"-F",
			"#{pane_id}",
			"-t",
			byAgent.get("A")?.paneId ?? "",
			"sleep",
			"1000",
		])
	).stdout.trim();

	monitor.targetList = monitor.targetList.filter(ref => ref.id !== "B");
	await manager.refresh();
	const after = await panes();
	expect(after.some(line => line.endsWith(" B"))).toBe(false);
	expect(after.some(line => line.includes(` ${userPane} `) || line.endsWith(` ${userPane}`))).toBe(true);
	expect(after.filter(line => line.startsWith("user "))).toHaveLength(1);
	expect(
		manager
			.status()
			.panes.map(pane => pane.agentId)
			.sort(),
	).toEqual(["A", "C", "Main/advisor"]);
});

it.skipIf(!tmuxPath)("does not reopen a pane the user closed, and stop leaves user panes and the session", async () => {
	const { monitor, create, tmux, panes, capabilityFiles } = await fixture();
	const manager = create();
	cleanups.push(() => manager.stop());
	monitor.targetList = [target("A"), target("B")];
	const status = await manager.start();
	const paneA = status.panes.find(pane => pane.agentId === "A");
	if (!paneA) throw new Error("no pane for A");
	const userPane = (
		await tmux(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", paneA.paneId, "sleep", "1000"])
	).stdout.trim();

	// What `npi monitor attach` does on Esc or Ctrl+C before its pane exits.
	await fsp.writeFile(paneClosedMarker(capabilityFiles[0] ?? ""), "");
	await tmux(["kill-pane", "-t", paneA.paneId]);
	await manager.refresh();
	await manager.refresh();
	expect(manager.status().panes.map(pane => pane.agentId)).toEqual(["B"]);

	await manager.stop();
	const left = await panes();
	expect(left.some(line => line.endsWith(" B"))).toBe(false);
	expect(left.some(line => line.includes(userPane))).toBe(true);
	expect(left.some(line => line.startsWith("npi-monitor-01234567 "))).toBe(true);
	expect(monitor.revoked()).toHaveLength(2);

	// The user's pane keeps the old session and its name: a new start picks the next one.
	const again = create();
	cleanups.push(() => again.stop());
	expect((await again.start()).sessionName).toBe("npi-monitor-01234567-2");
});

it.skipIf(!tmuxPath)("reopens a pane that exited without the close marker, a bounded number of times", async () => {
	const { monitor, create, tmux } = await fixture();
	const manager = create();
	cleanups.push(() => manager.stop());
	// B's pane keeps the session open while A's pane is gone.
	monitor.targetList = [target("A"), target("B")];
	let paneA = (await manager.start()).panes.find(pane => pane.agentId === "A")?.paneId;
	const seen = new Set([paneA]);
	// A failed or crashed attach leaves no marker while its grant is still valid.
	for (let exit = 1; exit < 3; exit++) {
		await tmux(["kill-pane", "-t", paneA ?? ""]);
		await manager.refresh();
		paneA = manager.status().panes.find(pane => pane.agentId === "A")?.paneId;
		expect(paneA).toBeDefined();
		expect(seen.has(paneA)).toBe(false);
		seen.add(paneA);
	}
	await tmux(["kill-pane", "-t", paneA ?? ""]);
	await manager.refresh();
	expect(manager.status().panes.map(pane => pane.agentId)).toEqual(["B"]);
});

it.skipIf(!tmuxPath)("a start that fails after creating its tmux session removes that session", async () => {
	const { create, panes, root } = await fixture();
	// mkdir of the capability directory fails: a file already has its name.
	await fsp.writeFile(path.join(root, "caps"), "");
	const manager = create();
	cleanups.push(() => manager.stop());
	await expect(manager.start()).rejects.toThrow();
	expect((await panes()).filter(line => line.startsWith("npi-monitor-"))).toEqual([]);
});

interface PaneGeometry {
	agent: string;
	window: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

async function geometry(
	tmux: (args: string[]) => Promise<{ stdout: string }>,
	session: string,
): Promise<PaneGeometry[]> {
	const out = await tmux([
		"list-panes",
		"-s",
		"-t",
		session,
		"-F",
		"#{@npi_agent} #{window_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height}",
	]);
	return out.stdout
		.trim()
		.split("\n")
		.map(line => {
			const [agent, window, x, y, width, height] = line.split(" ");
			return {
				agent: agent!,
				window: window!,
				x: Number(x),
				y: Number(y),
				width: Number(width),
				height: Number(height),
			};
		})
		.sort((a, b) => a.agent.localeCompare(b.agent));
}

it.skipIf(!tmuxPath)(
	"keeps 2×infinite rows-first in one equalized grid beyond the old six-pane cap",
	async () => {
		const { monitor, create, tmux } = await fixture({});
		const manager = create();
		cleanups.push(() => manager.stop());
		await manager.start();
		for (const id of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
			monitor.targetList.push(target(id));
			await manager.refresh();
		}
		const status = manager.status();
		expect(status.panes).toHaveLength(8);
		const panes = await geometry(tmux, status.sessionId);
		expect(new Set(panes.map(pane => pane.window)).size).toBe(1);
		expect(new Set(panes.map(pane => pane.x)).size).toBe(4);
		expect(new Set(panes.map(pane => pane.y)).size).toBe(2);
		for (let i = 0; i < 8; i += 2) {
			expect(panes[i]!.x).toBe(panes[i + 1]!.x);
			expect(panes[i]!.y).toBeLessThan(panes[i + 1]!.y);
		}
		expect(
			Math.max(...panes.map(pane => pane.width)) - Math.min(...panes.map(pane => pane.width)),
		).toBeLessThanOrEqual(1);
		expect(
			Math.max(...panes.map(pane => pane.height)) - Math.min(...panes.map(pane => pane.height)),
		).toBeLessThanOrEqual(1);
	},
	30_000,
);

it.skipIf(!tmuxPath)(
	"makes rows=1 full-height columns without overflowing a small terminal",
	async () => {
		const { monitor, create, tmux } = await fixture({ maxRows: 1 });
		const manager = create();
		cleanups.push(() => manager.stop());
		const status = await manager.start();
		await tmux(["resize-window", "-t", status.sessionId, "-x", "12", "-y", "12"]);
		monitor.targetList = "ABCDEFGH".split("").map(id => target(id));
		await manager.refresh();
		expect(manager.status().panes).toHaveLength(8);
		const panes = await geometry(tmux, status.sessionId);
		expect(new Set(panes.map(pane => pane.window)).size).toBe(1);
		expect(new Set(panes.map(pane => pane.x)).size).toBe(8);
		expect(new Set(panes.map(pane => pane.y)).size).toBe(1);
		expect(new Set(panes.map(pane => pane.height)).size).toBe(1);
	},
	30_000,
);

it.skipIf(!tmuxPath)(
	"opens another window only after filling both finite limits",
	async () => {
		const { monitor, create, tmux } = await fixture({ maxRows: 2, maxColumns: 2 });
		const manager = create();
		cleanups.push(() => manager.stop());
		monitor.targetList = "ABCD".split("").map(id => target(id));
		const status = await manager.start();
		expect(new Set(status.panes.map(pane => pane.windowId)).size).toBe(1);
		monitor.targetList.push(target("E"));
		await manager.refresh();
		const panes = await geometry(tmux, status.sessionId);
		expect(panes).toHaveLength(5);
		expect(new Set(panes.slice(0, 4).map(pane => pane.window)).size).toBe(1);
		expect(panes[4]!.window).not.toBe(panes[0]!.window);
	},
	30_000,
);

it.skipIf(!tmuxPath)(
	"preserves fixed cell dimensions and mirrors columns-first agent order",
	async () => {
		const { monitor, create, tmux } = await fixture({
			maxRows: 2,
			maxColumns: 2,
			fillOrder: "columns-first",
			direction: "up-left",
			columnWidth: 40,
			rowHeight: 12,
		});
		const manager = create();
		cleanups.push(() => manager.stop());
		monitor.targetList = "ABCD".split("").map(id => target(id));
		const status = await manager.start();
		const panes = await geometry(tmux, status.sessionId);
		expect(panes).toHaveLength(4);
		expect(panes.map(pane => pane.width)).toEqual([40, 40, 40, 40]);
		// The title uses its own row, not a cell from the fixed transcript height.
		expect(panes.map(pane => pane.height)).toEqual([12, 12, 12, 12]);
		expect(panes[0]!.x).toBeGreaterThan(panes[1]!.x);
		expect(panes[0]!.y).toBeGreaterThan(panes[2]!.y);
	},
	30_000,
);

it.skipIf(!tmuxPath)(
	"fills the new alternate edge before growing the next axis",
	async () => {
		const { monitor, create, tmux } = await fixture({ maxRows: "infinite", growth: "alternate" });
		const manager = create();
		cleanups.push(() => manager.stop());
		monitor.targetList = "ABCDEFG".split("").map(id => target(id));
		const status = await manager.start();
		const panes = await geometry(tmux, status.sessionId);
		expect(panes).toHaveLength(7);
		expect(new Set(panes.map(pane => pane.window)).size).toBe(1);
		expect(panes[4]!.y).toBe(panes[5]!.y);
		expect(panes[4]!.x).toBeLessThan(panes[5]!.x);
		expect(panes[6]!.x).toBeGreaterThan(panes[5]!.x);
		expect(panes[6]!.height).toBeGreaterThan(panes[0]!.height * 2);
	},
	30_000,
);

it.skipIf(!tmuxPath)(
	"supports the smallest positive fixed dimensions without implicit overflow",
	async () => {
		const { monitor, create, tmux } = await fixture({ maxRows: 2, columnWidth: 1, rowHeight: 1 });
		const manager = create();
		cleanups.push(() => manager.stop());
		monitor.targetList = "ABCD".split("").map(id => target(id));
		const status = await manager.start();
		const panes = await geometry(tmux, status.sessionId);
		expect(panes).toHaveLength(4);
		expect(new Set(panes.map(pane => pane.window)).size).toBe(1);
		expect(panes.map(pane => [pane.width, pane.height])).toEqual([
			[1, 1],
			[1, 1],
			[1, 1],
			[1, 1],
		]);
	},
	30_000,
);
