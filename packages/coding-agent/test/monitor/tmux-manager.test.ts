import { afterEach, expect, it } from "bun:test";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ControlMonitorService } from "../../src/control/monitor-service";
import { TmuxMonitorManager } from "../../src/monitor/tmux-manager";
import type { AgentRef } from "../../src/registry/agent-registry";

const tmuxPath = Bun.which("tmux");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function runTmux(socket: string, cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn([tmuxPath ?? "tmux", "-S", socket, ...args], {
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

async function fixture(maxPanesPerWindow = 2) {
	const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "npi-monitor-tmux-")));
	const socket = path.join(root, "private.sock");
	const tmux = (args: string[]) => runTmux(socket, root, args);
	const seed = await tmux(["-f", "/dev/null", "new-session", "-d", "-s", "user", "sleep", "1000"]);
	if (seed.exitCode !== 0) throw new Error("private tmux server did not start");
	cleanups.push(async () => {
		await tmux(["kill-server"]);
		await fsp.rm(root, { recursive: true, force: true });
	});
	const monitor = new FakeMonitor();
	const create = () =>
		new TmuxMonitorManager({
			monitor: monitor as unknown as Pick<ControlMonitorService, "targets" | "grant" | "revoke" | "authenticate">,
			// Syncs are driven by refresh(); registry events only schedule the same sync.
			registry: { onChange: () => () => {} },
			instanceId: "0123456789abcdef",
			cwd: root,
			capabilityDir: path.join(root, "caps"),
			paneCommand: () => ["sleep", "1000"],
			placeholderCommand: ["sleep", "1000"],
			includeAdvisors: () => true,
			maxPanesPerWindow: () => maxPanesPerWindow,
			runCli: async (argv, cwd) => runTmux(socket, cwd, argv.slice(1)),
			environment: () => ({ TMUX: socket }),
			pollMs: 60_000,
		});
	const panes = async (): Promise<string[]> =>
		(await tmux(["list-panes", "-a", "-F", "#{session_name} #{window_id} #{pane_id} #{@npi_agent}"])).stdout
			.trim()
			.split("\n");
	return { monitor, create, tmux, panes, root };
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
	const { monitor, create, tmux, panes } = await fixture();
	const manager = create();
	cleanups.push(() => manager.stop());
	monitor.targetList = [target("A"), target("B")];
	const status = await manager.start();
	const paneA = status.panes.find(pane => pane.agentId === "A");
	if (!paneA) throw new Error("no pane for A");
	const userPane = (
		await tmux(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", paneA.paneId, "sleep", "1000"])
	).stdout.trim();

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

it.skipIf(!tmuxPath)("a start that fails after creating its tmux session removes that session", async () => {
	const { create, panes, root } = await fixture();
	// mkdir of the capability directory fails: a file already has its name.
	await fsp.writeFile(path.join(root, "caps"), "");
	const manager = create();
	cleanups.push(() => manager.stop());
	await expect(manager.start()).rejects.toThrow();
	expect((await panes()).filter(line => line.startsWith("npi-monitor-"))).toEqual([]);
});
