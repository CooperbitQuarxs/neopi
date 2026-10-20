/**
 * Tmux agent monitor manager (#345).
 *
 * Owns one dedicated tmux session on the owner's tmux server (never the
 * user's own session or windows). Each subagent and advisor of the owner's
 * root gets an attach pane (`npi monitor attach`) the moment it is registered;
 * panes follow the configured grid, overflowing only at finite row/column capacity.
 * Parked and aborted agents keep their panes; a pane goes away only when its agent leaves
 * the registry or is replaced by a new generation. A pane the user closes is
 * not reopened for that agent generation; a pane that exits any other way
 * (attach failed, crashed) is reopened a few times. The manager only ever kills pane ids
 * it created; the session closes when its last pane does.
 *
 * Each pane authenticates with a per-agent capability the owner's control host
 * mints; the capability travels in a private file the pane deletes on read, so
 * it never appears in a process argument list.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { logger } from "@oh-my-pi/pi-utils";
import { getOriginalProcessEnv } from "@oh-my-pi/pi-utils/env";
import type { ControlMonitorService } from "../control/monitor-service";
import type { AgentRef, AgentRegistry } from "../registry/agent-registry";
import {
	createTerminalLauncher,
	processCli,
	type TerminalLaunchCliRunner,
	type TerminalLaunchRequest,
	type TerminalLaunchResult,
} from "../subprocess/terminal-launch";
import { monitorWindowCapacity, planMonitorLayout, type MonitorLayoutConfig } from "./layout";

/** One pane this manager created for an agent. */
export interface MonitorPane {
	agentId: string;
	kind: "sub" | "advisor";
	paneId: string;
	windowId: string;
}

export interface TmuxMonitorStatus {
	sessionName: string;
	sessionId: string;
	panes: MonitorPane[];
}

export interface TmuxMonitorManagerOptions {
	monitor: Pick<ControlMonitorService, "targets" | "grant" | "revoke" | "authenticate">;
	registry: Pick<AgentRegistry, "onChange">;
	/** Owner control instance id; names the session and identifies the owner to panes. */
	instanceId: string;
	cwd: string;
	/** Directory for capability files (created private, removed on stop). */
	capabilityDir: string;
	/** Command run in an agent pane for one capability file. */
	paneCommand: (capabilityFile: string) => string[];
	/** Command run in the placeholder pane while no agent has a pane. */
	placeholderCommand: string[];
	includeAdvisors: () => boolean;
	layout: () => MonitorLayoutConfig;
	/** Tmux CLI runner; defaults to the launcher's runner with the launcher environment restored. */
	runCli?: TerminalLaunchCliRunner;
	/** Environment the tmux client sees; defaults to the original launcher environment. */
	environment?: () => NodeJS.ProcessEnv;
	/** Dead-pane poll interval. */
	pollMs?: number;
}

interface PaneRecord extends MonitorPane {
	ref: AgentRef;
	capability: string;
	capabilityFile: string;
}

const SYNC_DEBOUNCE_MS = 100;
const DEFAULT_POLL_MS = 2_000;
/** Reopens of one agent generation's pane after exits the user did not ask for. */
const MAX_UNEXPECTED_EXITS = 3;

/**
 * File an attach pane writes next to its capability file when the user closes it
 * (Esc or Ctrl+C), so the manager can tell a deliberate close from a failed attach.
 */
export function paneClosedMarker(capabilityFile: string): string {
	return `${capabilityFile}.closed`;
}

export class TmuxMonitorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TmuxMonitorError";
	}
}

export class TmuxMonitorManager {
	readonly #options: TmuxMonitorManagerOptions;
	readonly #run: TerminalLaunchCliRunner;
	readonly #environment: () => NodeJS.ProcessEnv;
	readonly #launch: (request: TerminalLaunchRequest) => Promise<TerminalLaunchResult>;
	readonly #panes = new Map<string, PaneRecord>();
	/** Agent generations whose pane the user closed; not reopened until the ref changes. */
	readonly #closedByUser = new WeakSet<AgentRef>();
	/** Exits of an agent generation's panes that were neither a user close nor an ended grant. */
	readonly #unexpectedExits = new WeakMap<AgentRef, number>();
	#sessionName = "";
	#sessionId = "";
	#placeholder: { paneId: string; windowId: string } | undefined;
	#queue: Promise<void> = Promise.resolve();
	#unsubscribe: (() => void) | undefined;
	#debounce: Timer | undefined;
	#poll: Timer | undefined;
	#running = false;
	#onEnded: ((reason: string) => void) | undefined;

	constructor(options: TmuxMonitorManagerOptions) {
		this.#options = options;
		this.#environment = options.environment ?? (() => getOriginalProcessEnv());
		this.#run = options.runCli ?? ((argv, cwd) => processCli(argv, cwd, this.#environment()));
		this.#launch = createTerminalLauncher({ runCli: this.#run, environment: this.#environment });
	}

	get running(): boolean {
		return this.#running;
	}

	status(): TmuxMonitorStatus {
		return {
			sessionName: this.#sessionName,
			sessionId: this.#sessionId,
			panes: [...this.#panes.values()].map(({ agentId, kind, paneId, windowId }) => ({
				agentId,
				kind,
				paneId,
				windowId,
			})),
		};
	}

	/** Called once if tmux ends the monitor session from outside (e.g. `kill-session`). */
	onEnded(listener: (reason: string) => void): void {
		this.#onEnded = listener;
	}

	/** Create the dedicated session and start following the roster. */
	async start(): Promise<TmuxMonitorStatus> {
		if (this.#running) return this.status();
		if (!this.#environment().TMUX) {
			throw new TmuxMonitorError("the tmux monitor needs this session to run inside tmux");
		}
		const base = `npi-monitor-${this.#options.instanceId.slice(0, 8)}`;
		// A pane the user added keeps an earlier monitor session (and its name) alive after `/monitor off`.
		let name = base;
		for (let n = 2; await this.#sessionExists(name); n++) name = `${base}-${n}`;
		const created = await this.#tmux([
			"new-session",
			"-d",
			"-s",
			name,
			"-c",
			this.#options.cwd.replaceAll("#", "##"),
			"-P",
			"-F",
			"#{session_id} #{window_id} #{pane_id}",
			"--",
			...this.#options.placeholderCommand,
		]);
		const [sessionId, windowId, paneId] = created.trim().split(" ");
		if (!sessionId?.startsWith("$") || !windowId?.startsWith("@") || !paneId?.startsWith("%")) {
			throw new TmuxMonitorError("tmux did not report the monitor session it created");
		}
		// After the session exists, so a failed start leaves no directory behind. Until `#running`
		// is set, stop() does nothing, so a failure here removes the session's only pane itself.
		try {
			await fs.mkdir(this.#options.capabilityDir, { recursive: true, mode: 0o700 });
			await fs.chmod(this.#options.capabilityDir, 0o700);
		} catch (error) {
			await this.#tmux(["kill-pane", "-t", paneId]).catch(() => {});
			throw error;
		}
		this.#sessionName = name;
		this.#sessionId = sessionId;
		this.#placeholder = { paneId, windowId };
		this.#running = true;
		await this.#decorateWindow(windowId);
		this.#unsubscribe = this.#options.registry.onChange(() => this.#scheduleSync());
		this.#poll = setInterval(() => this.#enqueue(() => this.#sync()), this.#options.pollMs ?? DEFAULT_POLL_MS);
		this.#poll.unref?.();
		await this.#enqueue(() => this.#sync());
		return this.status();
	}

	/** Revoke every pane's capability and kill the panes this manager created. */
	async stop(): Promise<void> {
		if (!this.#running) return;
		this.#running = false;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		clearTimeout(this.#debounce);
		clearInterval(this.#poll);
		await this.#queue;
		const owned = [...this.#panes.values()].map(pane => pane.paneId);
		if (this.#placeholder) owned.push(this.#placeholder.paneId);
		for (const pane of this.#panes.values()) this.#options.monitor.revoke(pane.capability);
		this.#panes.clear();
		this.#placeholder = undefined;
		// Only the panes this manager created: tmux closes the session with its last pane,
		// and a pane or window the user added to it stays.
		const alive = await this.#livePanes();
		const targets = owned.filter(paneId => alive?.has(paneId));
		this.#sessionId = "";
		if (targets.length > 0) {
			await this.#tmux(targets.flatMap((paneId, i) => [...(i > 0 ? [";"] : []), "kill-pane", "-t", paneId])).catch(
				() => {},
			);
		}
		await fs.rm(this.#options.capabilityDir, { recursive: true, force: true });
	}

	/** Run one sync now (tests, `/monitor` refresh). */
	refresh(): Promise<void> {
		return this.#enqueue(() => this.#sync());
	}

	#scheduleSync(): void {
		if (!this.#running || this.#debounce) return;
		this.#debounce = setTimeout(() => {
			this.#debounce = undefined;
			void this.#enqueue(() => this.#sync());
		}, SYNC_DEBOUNCE_MS);
		this.#debounce.unref?.();
	}

	#enqueue(work: () => Promise<void>): Promise<void> {
		const next = this.#queue.then(work).catch(error => {
			logger.warn("monitor: tmux sync failed", { error: String(error) });
		});
		this.#queue = next;
		return next;
	}

	async #sync(): Promise<void> {
		if (!this.#running) return;
		const alive = await this.#livePanes();
		if (!alive) {
			// The session is gone: tmux or the user ended it. Nothing of ours is left to clean.
			const reason = "the monitor tmux session was closed";
			this.#running = false;
			this.#unsubscribe?.();
			clearInterval(this.#poll);
			for (const pane of this.#panes.values()) this.#options.monitor.revoke(pane.capability);
			this.#panes.clear();
			this.#sessionId = "";
			await fs.rm(this.#options.capabilityDir, { recursive: true, force: true });
			this.#onEnded?.(reason);
			return;
		}
		const touched = new Set<string>();
		if (this.#placeholder && !alive.has(this.#placeholder.paneId)) this.#placeholder = undefined;
		// Panes that exited on their own (the user pressed Esc/Ctrl+C, or the pane ended).
		for (const [agentId, pane] of [...this.#panes]) {
			if (alive.has(pane.paneId)) continue;
			touched.add(pane.windowId);
			this.#panes.delete(agentId);
			const marker = paneClosedMarker(pane.capabilityFile);
			// One whose grant ended (root session replaced) gets a fresh pane and grant. One that
			// exited while its grant was valid stays closed if the user closed it; any other exit is
			// reopened, until it has happened MAX_UNEXPECTED_EXITS times for this agent generation.
			if (this.#options.monitor.authenticate(pane.capability)) {
				if (await Bun.file(marker).exists()) {
					this.#closedByUser.add(pane.ref);
				} else {
					const exits = (this.#unexpectedExits.get(pane.ref) ?? 0) + 1;
					this.#unexpectedExits.set(pane.ref, exits);
					if (exits >= MAX_UNEXPECTED_EXITS) {
						logger.warn("monitor: agent pane keeps exiting; not reopening it", { agentId, exits });
						this.#closedByUser.add(pane.ref);
					}
				}
			}
			this.#options.monitor.revoke(pane.capability);
			await fs.rm(pane.capabilityFile, { force: true });
			await fs.rm(marker, { force: true });
		}
		const includeAdvisors = this.#options.includeAdvisors();
		const wanted = new Map<string, AgentRef & { kind: "sub" | "advisor" }>();
		for (const ref of this.#options.monitor.targets()) {
			if (ref.kind === "advisor" && !includeAdvisors) continue;
			wanted.set(ref.id, ref);
		}
		for (const [agentId, pane] of [...this.#panes]) {
			if (wanted.get(agentId) === pane.ref) continue;
			await this.#removePane(pane, touched);
		}
		for (const ref of wanted.values()) {
			if (this.#panes.has(ref.id) || this.#closedByUser.has(ref)) continue;
			await this.#addPane(ref, touched);
		}
		for (const windowId of touched) await this.#arrangeWindow(windowId);
	}

	/** Pane id → window id for every pane of the monitor session, or undefined when the session is gone. */
	async #livePanes(): Promise<Map<string, string> | undefined> {
		let out: string;
		try {
			out = await this.#tmux(["list-panes", "-s", "-t", this.#sessionId, "-F", "#{pane_id} #{window_id}"]);
		} catch {
			return undefined;
		}
		const panes = new Map<string, string>();
		for (const line of out.split("\n")) {
			const [paneId, windowId] = line.trim().split(" ");
			if (paneId && windowId) panes.set(paneId, windowId);
		}
		return panes;
	}

	async #addPane(ref: AgentRef & { kind: "sub" | "advisor" }, touched: Set<string>): Promise<void> {
		let capability: string;
		try {
			({ capability } = this.#options.monitor.grant(ref.id));
		} catch (error) {
			logger.debug("monitor: agent not grantable", { agentId: ref.id, error: String(error) });
			return;
		}
		const capabilityFile = path.join(this.#options.capabilityDir, `${randomBytes(8).toString("hex")}.cap`);
		await fs.writeFile(capabilityFile, capability, { mode: 0o600, flag: "wx" });
		const command = this.#options.paneCommand(capabilityFile);
		let placed: { paneId: string; windowId: string } | undefined;
		try {
			placed = await this.#placePane(command);
		} catch (error) {
			this.#options.monitor.revoke(capability);
			await fs.rm(capabilityFile, { force: true });
			throw error;
		}
		this.#panes.set(ref.id, { agentId: ref.id, kind: ref.kind, ref, capability, capabilityFile, ...placed });
		// A pane user option, not the title: the pane's own program may retitle itself.
		await this.#tmux(["set-option", "-p", "-t", placed.paneId, "@npi_agent", ref.id]).catch(() => {});
		touched.add(placed.windowId);
		// The placeholder only holds the session open while no agent has a pane.
		if (this.#placeholder) {
			const placeholder = this.#placeholder;
			this.#placeholder = undefined;
			await this.#tmux(["kill-pane", "-t", placeholder.paneId]).catch(() => {});
			touched.add(placeholder.windowId);
		}
		await this.#arrangeWindow(placed.windowId);
		touched.delete(placed.windowId);
	}

	/** Fill a monitor window to its configured capacity, never overflow on split failure. */
	async #placePane(command: string[]): Promise<{ paneId: string; windowId: string }> {
		const max = monitorWindowCapacity(this.#options.layout());
		const counts = new Map<string, { count: number; anchor: string }>();
		const note = (windowId: string, paneId: string): void => {
			const entry = counts.get(windowId);
			if (entry) entry.count++;
			else counts.set(windowId, { count: 1, anchor: paneId });
		};
		for (const pane of this.#panes.values()) note(pane.windowId, pane.paneId);
		// The placeholder is about to go, so it does not take a slot.
		if (this.#placeholder && !counts.has(this.#placeholder.windowId)) {
			counts.set(this.#placeholder.windowId, { count: 0, anchor: this.#placeholder.paneId });
		}
		const candidates = [...counts.entries()].filter(([, entry]) => entry.count < max);
		candidates.sort((a, b) => b[1].count - a[1].count);
		const candidate = candidates[0];
		if (candidate) {
			const [windowId, entry] = candidate;
			const anchor = await this.#prepareSplit(windowId, entry.anchor);
			const result = await this.#launch({
				multiplexer: "tmux",
				placement: "pane",
				target: anchor,
				direction: "right",
				focus: false,
				execution: "direct",
				cwd: this.#options.cwd,
				command,
			});
			if (!result.id) throw new TmuxMonitorError("tmux did not report the monitor pane it created");
			return { paneId: result.id, windowId };
		}
		const result = await this.#launch({
			multiplexer: "tmux",
			placement: "window",
			target: this.#sessionId,
			focus: false,
			execution: "direct",
			cwd: this.#options.cwd,
			command,
		});
		const windowId = result.id;
		if (!windowId) throw new TmuxMonitorError("tmux did not report the monitor window it created");
		const paneId = (await this.#tmux(["list-panes", "-t", windowId, "-F", "#{pane_id}"])).trim().split("\n")[0];
		if (!paneId?.startsWith("%")) throw new TmuxMonitorError("tmux did not report the monitor pane it created");
		await this.#decorateWindow(windowId);
		return { paneId, windowId };
	}

	async #windowGeometry(windowId: string): Promise<{ width: number; height: number } | undefined> {
		const result = await this.#run(
			["tmux", "display-message", "-p", "-t", windowId, "#{window_width} #{window_height}"],
			this.#options.cwd,
		);
		if (result.exitCode !== 0) return undefined;
		const [width, height] = result.stdout.trim().split(" ").map(Number);
		if (!width || !height) return undefined;
		return { width, height };
	}

	async #resizeWindow(windowId: string, width: number, height: number): Promise<void> {
		// tmux cannot represent an unlimited number of physical cells. Do not turn
		// this hard limit (or any other CLI failure) into implicit window overflow.
		if (width > 32767 || height > 32767) throw new TmuxMonitorError("Monitor layout exceeds tmux's 32767-cell window limit");
		await this.#tmux(["resize-window", "-t", windowId, "-x", String(width), "-y", String(height)]);
	}

	/** Make splitting possible even when the attached terminal is already full. */
	async #prepareSplit(windowId: string, fallback: string): Promise<string> {
		const geometry = await this.#windowGeometry(windowId);
		if (!geometry) throw new TmuxMonitorError("Monitor window disappeared before pane creation");
		const owned = [...this.#panes.values()].filter(pane => pane.windowId === windowId).map(pane => pane.paneId);
		if (owned.length === 0) owned.push(fallback);
		const config = this.#options.layout();
		// A temporary horizontal split needs at least three cells. Fixed widths may
		// be smaller; restore their requested dimensions immediately after creation.
		const splitConfig = { ...config, columnWidth: "dynamic" as const, rowHeight: "dynamic" as const };
		const current = planMonitorLayout(owned, splitConfig, geometry.width, geometry.height, true);
		const width = current.width;
		const height = current.height;
		if (width !== geometry.width || height !== geometry.height) await this.#resizeWindow(windowId, width, height);
		await this.#arrangeWindow(windowId, splitConfig, width, height);
		const out = await this.#tmux(["list-panes", "-t", windowId, "-F", "#{pane_id} #{pane_width}"]);
		let anchor = fallback;
		let largest = 0;
		for (const line of out.trim().split("\n")) {
			const [id, size] = line.split(" ");
			if (id && owned.includes(id) && Number(size) > largest) {
				anchor = id;
				largest = Number(size);
			}
		}
		return anchor;
	}

	async #arrangeWindow(
		windowId: string,
		config = this.#options.layout(),
		width?: number,
		height?: number,
	): Promise<void> {
		const paneIds = [...this.#panes.values()].filter(pane => pane.windowId === windowId).map(pane => pane.paneId);
		if (!paneIds.length || paneIds.length > monitorWindowCapacity(config)) return;
		const geometry = await this.#windowGeometry(windowId);
		if (!geometry) return;
		const actual = (await this.#tmux(["list-panes", "-t", windowId, "-F", "#{pane_id}"])).trim().split("\n");
		// A user-added pane is not a layout slot owned by the monitor.
		if (actual.some(id => !paneIds.includes(id))) return;
		const plan = planMonitorLayout(paneIds, config, width ?? geometry.width, height ?? geometry.height, true);
		if (plan.width !== geometry.width || plan.height !== geometry.height) {
			await this.#resizeWindow(windowId, plan.width, plan.height);
		}
		await this.#tmux(["select-layout", "-t", windowId, plan.layout]);
		// select-layout restores geometry, not the pane ids encoded in a saved
		// layout. Restore identity explicitly so split history cannot change fill order.
		const positions = await this.#tmux([
			"list-panes", "-t", windowId, "-F", "#{pane_id} #{pane_left},#{pane_top}",
		]);
		const byPosition = new Map<string, string>();
		const byId = new Map<string, string>();
		for (const line of positions.trim().split("\n")) {
			const [id, position] = line.split(" ");
			if (id && position) {
				byPosition.set(position, id);
				byId.set(id, position);
			}
		}
		const swaps: string[] = [];
		for (const pane of plan.panes) {
			const destination = `${pane.x},${pane.y}`;
			const occupant = byPosition.get(destination);
			const source = byId.get(pane.id);
			if (!occupant || !source) throw new TmuxMonitorError("tmux did not preserve the requested monitor geometry");
			if (occupant === pane.id) continue;
			if (swaps.length) swaps.push(";");
			swaps.push("swap-pane", "-d", "-s", pane.id, "-t", occupant);
			byPosition.set(destination, pane.id);
			byPosition.set(source, occupant);
			byId.set(pane.id, destination);
			byId.set(occupant, source);
		}
		if (swaps.length) await this.#tmux(swaps);
	}

	async #removePane(pane: PaneRecord, touched: Set<string>): Promise<void> {
		this.#panes.delete(pane.agentId);
		this.#options.monitor.revoke(pane.capability);
		await fs.rm(pane.capabilityFile, { force: true });
		if (this.#panes.size === 0 && !this.#placeholder) {
			// Keep the session (and any attached client) alive with a placeholder.
			const placed = await this.#launch({
				multiplexer: "tmux",
				placement: "pane",
				target: pane.paneId,
				direction: "right",
				focus: false,
				execution: "direct",
				cwd: this.#options.cwd,
				command: this.#options.placeholderCommand,
			}).catch(() => undefined);
			if (placed?.id) this.#placeholder = { paneId: placed.id, windowId: pane.windowId };
		}
		await this.#tmux(["kill-pane", "-t", pane.paneId]).catch(() => {});
		touched.add(pane.windowId);
	}

	/** Window options on the monitor's own windows only: pane titles show the agent id. */
	async #decorateWindow(windowId: string): Promise<void> {
		await this.#tmux(["set-option", "-w", "-t", windowId, "pane-border-status", "top"]).catch(() => {});
		await this.#tmux([
			"set-option",
			"-w",
			"-t",
			windowId,
			"pane-border-format",
			" #{?@npi_agent,#{@npi_agent},npi monitor} ",
		]).catch(() => {});
	}

	async #sessionExists(name: string): Promise<boolean> {
		const result = await this.#run(["tmux", "has-session", "-t", `=${name}`], this.#options.cwd);
		return result.exitCode === 0;
	}

	async #tmux(args: string[]): Promise<string> {
		const result = await this.#run(["tmux", ...args], this.#options.cwd);
		if (result.exitCode !== 0) throw new TmuxMonitorError(`tmux ${args[0]} failed (exit ${result.exitCode})`);
		return result.stdout;
	}
}
