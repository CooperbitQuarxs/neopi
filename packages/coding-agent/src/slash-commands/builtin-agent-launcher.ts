import { runAgentLauncher } from "../neopi/agent-launcher";
import { clearSubmittedText } from "./helpers/draft";
import type { SlashCommandSpec } from "./types";

export const AGENT_LAUNCHER_COMMAND: SlashCommandSpec = {
	name: "agent",
	icon: "agents",
	description: "Launch a named worker or advisor after reviewing its resolved model and cost",
	allowArgs: true,
	subcommands: [{ name: "launch", description: "Choose preset, model, effort, tools, policy and fixed name" }],
	handle: async (_command, runtime) => {
		await runtime.output("/agent launch opens an interactive launcher and is only available in the TUI.");
	},
	handleTui: async (command, runtime) => {
		clearSubmittedText(runtime);
		if (command.args.trim() !== "launch") {
			runtime.ctx.showStatus("Usage: /agent launch. No agent starts until you confirm the resolved model.");
			return;
		}
		const ui = runtime.ctx.getToolUIContext();
		if (!ui) {
			runtime.ctx.showStatus("Agent launcher is unavailable until the interactive dialogs are ready.");
			return;
		}
		try {
			const result = await runAgentLauncher(runtime.ctx.session, ui);
			if (result) runtime.ctx.showStatus(result);
		} catch (error) {
			runtime.ctx.showError(error instanceof Error ? error.message : String(error));
		}
	},
};
