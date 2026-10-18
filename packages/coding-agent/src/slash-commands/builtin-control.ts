import { APP_NAME } from "@oh-my-pi/pi-utils";
import { runPauseScreen } from "@oh-my-pi/pi-tui/overlays/pause-screen";
import { clearSubmittedText } from "./helpers/draft";
import { shutdownHandlerTui } from "./builtin-lifecycle";
import { agentMonitorFor, startAgentMonitor, stopAgentMonitor } from "../monitor/controller";
import { commandConsumed, errorMessage, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_CONTROL_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "force",
		icon: "hammer",
		description: "Force next turn to use a specific tool",
		aliases: ["force:"],
		inlineHint: "<tool-name> [prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			const count = runtime.ctx.session.getActiveToolNames().length;
			return count === 0 ? "Force: no active tools" : `Force: ${count} active tools`;
		},
		handle: async (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();
			if (!toolName) return usage("Usage: /force:<tool-name> [prompt]", runtime);
			try {
				runtime.session.setForcedToolChoice(toolName);
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			await runtime.output(`Next turn forced to use ${toolName}.`);
			return prompt ? { prompt } : commandConsumed();
		},
		handleTui: (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();

			if (!toolName) {
				runtime.ctx.showError("Usage: /force:<tool-name> [prompt]");
				clearSubmittedText(runtime);
				return;
			}

			try {
				runtime.ctx.session.setForcedToolChoice(toolName);
				runtime.ctx.showStatus(`Next turn forced to use ${toolName}.`);
			} catch (error) {
				runtime.ctx.showError(errorMessage(error));
				clearSubmittedText(runtime);
				return;
			}

			clearSubmittedText(runtime);

			// If a prompt was provided, pass it through as input
			if (prompt) return { prompt };
		},
	},
	{
		name: "live",
		icon: "voice",
		description: "Start Codex-backed realtime voice mode",
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleLiveCommand();
		},
	},
	{
		name: "record",
		icon: "export",
		description: `Start or stop recording this screen to a replayable file (${APP_NAME} play)`,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.toggleRecording();
		},
	},
	{
		name: "pause",
		icon: "pause",
		description: "Freeze all agents (main, subagents, advisor) until resumed",
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runPauseScreen(runtime.ctx);
		},
	},
	{
		name: "monitor",
		icon: "eye",
		description: "Open a tmux session with one live pane per subagent and advisor",
		inlineHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: "Start the monitor session (default)" },
			{ name: "off", description: "Close the monitor session and its panes" },
			{ name: "status", description: "Show the monitor session and its panes" },
		],
		allowArgs: true,
		handleTui: async (command, runtime) => {
			clearSubmittedText(runtime);
			const { ctx } = runtime;
			const action = command.args.trim() || "on";
			try {
				if (action === "off") {
					const stopped = await stopAgentMonitor(ctx.session);
					ctx.showStatus(stopped ? "Agent monitor closed." : "The agent monitor is not running.");
					return;
				}
				if (action === "status") {
					const manager = agentMonitorFor(ctx.session);
					if (!manager) {
						ctx.showStatus("The agent monitor is not running. /monitor on starts it.");
						return;
					}
					const status = manager.status();
					const panes = status.panes.map(pane => `${pane.agentId} (${pane.paneId})`).join(", ") || "no agent panes";
					ctx.showStatus(`Agent monitor: tmux session ${status.sessionName} · ${panes}`);
					return;
				}
				if (action !== "on") {
					ctx.showError("Usage: /monitor [on|off|status]");
					return;
				}
				const status = await startAgentMonitor(ctx.session, ctx.settings);
				ctx.showStatus(
					`Agent monitor running in tmux session ${status.sessionName}. View it from another terminal: tmux attach -t ${status.sessionName}`,
				);
			} catch (error) {
				ctx.showError(errorMessage(error));
			}
		},
	},
	{
		name: "quit",
		aliases: ["q"],
		icon: "power",
		description: "Quit the application",
		handleTui: shutdownHandlerTui,
	},
];
