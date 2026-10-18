/**
 * Tmux agent monitor settings (#345).
 *
 * The monitor is opt-in: `/monitor on` starts it for the current session, and
 * `monitor.tmux.autoStart` starts it whenever an interactive session opens
 * inside tmux. It always uses its own tmux session on the owner's tmux server.
 */
import { register } from "../config/registry";

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

export const cfgMonitorMaxPanesPerWindow = register({
	id: "monitor.tmux.maxPanesPerWindow",
	type: "number",
	default: 6,
	ui: {
		tab: "interaction",
		group: "Agent monitor",
		label: "Monitor panes per window",
		description: "Tiled agent panes per monitor window before the monitor opens another window",
	},
});
