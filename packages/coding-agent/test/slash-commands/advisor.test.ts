import { describe, expect, it } from "bun:test";
import type { AgentSession } from "../../src/session/agent-session";
import type { InteractiveModeContext } from "../../src/modes/types";
import { lookupBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";
import type { SlashCommandRuntime } from "../../src/slash-commands/types";

const advisorCommand = lookupBuiltinSlashCommand("advisor")!;

function session(): AgentSession {
	return {
		setAdvisorEnabled: () => true,
		toggleAdvisorEnabled: () => true,
		isAdvisorEnabled: () => true,
		getAdvisorStatusOverview: () => ({
			configured: true,
			advisors: [
				{ name: "Velvet", status: "running" },
				{ name: "Architecture", status: "running" },
				{ name: "Paused", status: "paused" },
				{ name: "Unresolved", status: "no_model" },
			],
		}),
	} as unknown as AgentSession;
}

describe("advisor activation announcements", () => {
	for (const verb of ["on", "toggle"]) {
		it(`names the started advisors for ${verb} in text hosts`, async () => {
			const messages: string[] = [];
			await advisorCommand.handle?.({ name: "advisor", args: verb, text: `/advisor ${verb}` }, {
				session: session(),
				output: text => {
					messages.push(text);
				},
			} as SlashCommandRuntime);
			expect(messages).toEqual(["Advisor enabled: Velvet, Architecture."]);
		});

		it(`names the started advisors for ${verb} in the TUI`, async () => {
			const messages: string[] = [];
			const ctx = {
				session: session(),
				showStatus: (text: string) => {
					messages.push(text);
				},
				statusLine: { invalidate: () => {} },
				ui: { requestRender: () => {} },
				editor: { setText: () => {} },
			} as unknown as InteractiveModeContext;
			await advisorCommand.handleTui?.({ name: "advisor", args: verb, text: `/advisor ${verb}` }, { ctx });
			expect(messages).toEqual(["Advisor enabled: Velvet, Architecture."]);
		});
	}
});
