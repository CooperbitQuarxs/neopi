/**
 * Per-session lifetime of the tmux agent monitor (#345): `/monitor`, the
 * `monitor.tmux.autoStart` setting, and owner disposal all go through here.
 */
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { getActiveProfile, getConfigDirName } from "@oh-my-pi/pi-utils/dirs";
import { getOriginalProcessEnv } from "@oh-my-pi/pi-utils/env";
import type { Settings } from "../config/settings";
import { controlHostFor } from "../control/host";
import { controlSessionsDir } from "../control/registry";
import { AgentRegistry } from "../registry/agent-registry";
import type { AgentSession } from "../session/agent-session";
import { scopeEnvCommand } from "../subprocess/terminal-launch";
import { resolveCliEntryCmd } from "../subprocess/worker-client";
import { cfgMonitorIncludeAdvisors, cfgMonitorMaxPanesPerWindow } from "./settings";
import { TmuxMonitorError, TmuxMonitorManager, type TmuxMonitorStatus } from "./tmux-manager";

const managers = new WeakMap<AgentSession, TmuxMonitorManager>();

/** The monitor manager running for `session`, if any. */
export function agentMonitorFor(session: AgentSession): TmuxMonitorManager | undefined {
	const manager = managers.get(session);
	return manager?.running ? manager : undefined;
}

/** Start the monitor for `session` (idempotent). Throws a user-displayable error when it cannot run. */
export async function startAgentMonitor(session: AgentSession, settings: Settings): Promise<TmuxMonitorStatus> {
	const existing = agentMonitorFor(session);
	if (existing) return existing.status();
	const host = controlHostFor(session);
	if (!host?.publication) {
		throw new TmuxMonitorError("the tmux monitor needs the control socket (control.enabled)");
	}
	const launcher = getOriginalProcessEnv();
	const profile = getActiveProfile();
	// Pin the scope the pane needs to find this owner and load the same config.
	const scope = scopeEnvCommand({
		PI_CODING_AGENT_DIR: settings.getAgentDir(),
		PI_CONFIG_DIR: getConfigDirName(),
		OMP_PROFILE: profile,
		PI_PROFILE: profile,
		PI_CONFIG_FILES: settings.getConfigFiles().join(path.delimiter),
		PI_CONTROL_DIR: controlSessionsDir(),
		XDG_DATA_HOME: launcher.XDG_DATA_HOME,
		XDG_STATE_HOME: launcher.XDG_STATE_HOME,
		XDG_CACHE_HOME: launcher.XDG_CACHE_HOME,
	});
	const cli = [...scope, ...resolveCliEntryCmd(), "monitor"];
	const manager = new TmuxMonitorManager({
		monitor: host.monitor,
		registry: AgentRegistry.global(),
		instanceId: host.instanceId,
		cwd: session.sessionManager.getCwd(),
		capabilityDir: path.join(controlSessionsDir(), `monitor-${host.instanceId}`),
		paneCommand: file => [...cli, "attach", host.instanceId, "--capability-file", file],
		placeholderCommand: [...cli, "idle", host.instanceId],
		includeAdvisors: () => cfgMonitorIncludeAdvisors.get(settings) === true,
		maxPanesPerWindow: () => Number(cfgMonitorMaxPanesPerWindow.get(settings)) || 6,
	});
	manager.onEnded(reason => {
		if (managers.get(session) === manager) managers.delete(session);
		session.emitNotice("info", `Agent monitor stopped: ${reason}`, "monitor");
	});
	managers.set(session, manager);
	try {
		const status = await manager.start();
		session.addDisposer(() => {
			void manager.stop().catch(error => logger.warn("monitor: stop on dispose failed", { error: String(error) }));
		});
		return status;
	} catch (error) {
		managers.delete(session);
		await manager.stop().catch(() => {});
		throw error;
	}
}

/** Stop the monitor for `session`. Returns false when none was running. */
export async function stopAgentMonitor(session: AgentSession): Promise<boolean> {
	const manager = agentMonitorFor(session);
	if (!manager) return false;
	managers.delete(session);
	await manager.stop();
	return true;
}
