/**
 * Tmux agent monitor manager (#345).
 *
 * Owns one dedicated tmux session on the owner's tmux server (never the
 * user's own session or windows). Each subagent and advisor of the owner's
 * root gets an attach pane (`npi monitor attach`) the moment it is registered;
 * panes are tiled per window and overflow into further windows. Parked and
 * aborted agents keep their panes; a pane goes away only when its agent leaves
 * the registry or is replaced by a new generation. A pane the user closes is
 * not reopened for that agent generation. The manager only ever kills pane ids
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
import { createTerminalLauncher, processCli, type TerminalLaunchCliRunner } from "../subprocess/terminal-launch";

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
	maxPanesPerWindow: () => number;
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
	readonly #launch: ReturnType<typeof createTerminalLauncher>;
	readonly #panes = new Map<string, PaneRecord>();
	/** Agent generations whose pane the user closed; not reopened until the ref changes. */
	readonly #closedByUser = new WeakSet<AgentRef>();
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
		if (this.#placeholder && !alive.has(this.#placeholder.paneId)) this.#placeholder = undefined;
		// Panes that exited on their own (the user pressed Esc/Ctrl+C, or the pane ended).
		for (const [agentId, pane] of [...this.#panes]) {
			if (alive.has(pane.paneId)) continue;
			this.#panes.delete(agentId);
			// A pane that exited while its grant was still valid was closed by the user. One
			// whose grant ended (root session replaced) gets a fresh pane and grant.
			if (this.#options.monitor.authenticate(pane.capability)) this.#closedByUser.add(pane.ref);
			this.#options.monitor.revoke(pane.capability);
			await fs.rm(pane.capabilityFile, { force: true });
		}
		const includeAdvisors = this.#options.includeAdvisors();
		const wanted = new Map<string, AgentRef & { kind: "sub" | "advisor" }>();
		for (const ref of this.#options.monitor.targets()) {
			if (ref.kind === "advisor" && !includeAdvisors) continue;
			wanted.set(ref.id, ref);
		}
		const touched = new Set<string>();
		for (const [agentId, pane] of [...this.#panes]) {
			if (wanted.get(agentId) === pane.ref) continue;
			await this.#removePane(pane, touched);
		}
		for (const ref of wanted.values()) {
			if (this.#panes.has(ref.id) || this.#closedByUser.has(ref)) continue;
			await this.#addPane(ref, touched);
		}
		for (const windowId of touched) await this.#tmux(["select-layout", "-t", windowId, "tiled"]).catch(() => {});
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
	}

	/** Split into the fullest window with room, or open a new window in the monitor session. */
	async #placePane(command: string[]): Promise<{ paneId: string; windowId: string }> {
		const max = Math.max(1, Math.trunc(this.#options.maxPanesPerWindow()));
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
		for (const [windowId, entry] of candidates) {
			try {
				const result = await this.#launch({
					multiplexer: "tmux",
					placement: "pane",
					target: entry.anchor,
					direction: "right",
					focus: false,
					execution: "direct",
					cwd: this.#options.cwd,
					command,
				});
				if (result.id) return { paneId: result.id, windowId };
			} catch (error) {
				// A window too small to split: tile it and use a new window instead.
				logger.debug("monitor: split failed", { windowId, error: String(error) });
				await this.#tmux(["select-layout", "-t", windowId, "tiled"]).catch(() => {});
			}
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
