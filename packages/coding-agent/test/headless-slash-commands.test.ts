/**
 * Terminal-only builtins whose action is not inherently interactive run headless (RPC, ACP, control): `/personality` and `/notice`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { BUILTIN_PERSONALITIES } from "@oh-my-pi/pi-coding-agent/neopi/personalities";
import { currentPersonalityName, saveCustomPersonality } from "@oh-my-pi/pi-coding-agent/neopi/personality-settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	executeAcpBuiltinSlashCommand,
	lookupTuiOnlyBuiltin,
} from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { buildAvailableSlashCommands } from "@oh-my-pi/pi-coding-agent/slash-commands/available-commands";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

describe("headless builtins", () => {
	let authStorage: AuthStorage;
	let settings: Settings;
	let session: AgentSession;
	let output: string[];

	beforeEach(() => {
		authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model");
		const mock = createMockModel({ handler: () => ({ content: ["ok"] }) });
		settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
		session = new AgentSession({
			agent: new Agent({
				initialState: { model, systemPrompt: ["Test"], tools: [] },
				getApiKey: () => "test-key",
				convertToLlm,
				streamFn: mock.stream,
			}),
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry: new ModelRegistry(authStorage),
		});
		output = [];
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await session.dispose();
		authStorage.close();
	});

	function run(text: string) {
		return executeAcpBuiltinSlashCommand(text, {
			session,
			sessionManager: session.sessionManager,
			settings,
			cwd: process.cwd(),
			output: line => void output.push(line),
			refreshCommands: () => {},
			reloadPlugins: async () => {},
		});
	}

	test("none of them is terminal-only any more, and the catalog says so", async () => {
		for (const name of ["personality", "notice"]) expect(lookupTuiOnlyBuiltin(`/${name}`)).toBeUndefined();
		const commands = await buildAvailableSlashCommands(
			{
				customCommands: [],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands: () => {},
			} as never,
			async () => [],
		);
		const byName = Object.fromEntries(commands.map(command => [command.name, command.availability]));
		expect([byName.personality, byName.notice]).toEqual(["headless", "headless"]);
		expect(byName.settings).toBe("tui");
	});

	describe("/personality", () => {
		test("without a name lists the current and available personalities and asks for a name", async () => {
			expect(await run("/personality")).toEqual({ consumed: true });
			const text = output.join("\n");
			expect(text).toContain(`Personality: ${currentPersonalityName(settings)}`);
			for (const name of BUILTIN_PERSONALITIES) expect(text).toContain(name);
			expect(text).toContain("Usage: /personality <name>");
		});

		test("sets a built-in personality for the session, matching case-insensitively", async () => {
			const target = [...BUILTIN_PERSONALITIES].find(name => name !== currentPersonalityName(settings));
			if (!target) throw new Error("Expected a second built-in personality");
			expect(await run(`/personality ${target.toUpperCase()}`)).toEqual({ consumed: true });
			expect(currentPersonalityName(settings)).toBe(target);
			expect(
				settings.getProvenance(
					await import("@oh-my-pi/pi-coding-agent/session/settings").then(m => m.cfgPersonality),
				),
			).toBe("session");
			expect(output.join("\n")).toContain(`Personality: ${target} (session)`);
		});

		test("sets a custom personality and refuses unknown names without changing anything", async () => {
			saveCustomPersonality(settings, "session", "Zesty", "Be zesty.");
			expect(await run("/personality Zesty")).toEqual({ consumed: true });
			expect(currentPersonalityName(settings)).toBe("Zesty");
			expect(await run("/personality nobody-by-this-name")).toEqual({ consumed: true, failed: true });
			expect(output.at(-1)).toBe("Unknown or ambiguous personality: nobody-by-this-name");
			expect(currentPersonalityName(settings)).toBe("Zesty");
		});
	});

	describe("/notice", () => {
		test("sends the operator notice as a steering message and reports an agent turn", async () => {
			const prompt = vi.spyOn(session, "prompt").mockResolvedValue(undefined);
			expect(await run("/notice  check the logs")).toEqual({ consumed: true, agentInvoked: true });
			expect(prompt).toHaveBeenCalledTimes(1);
			const [message, options] = prompt.mock.calls[0];
			expect(message).toContain("check the logs");
			expect(options).toMatchObject({
				synthetic: true,
				attribution: "user",
				streamingBehavior: "steer",
				rawText: "/notice  check the logs",
			});
		});

		test("needs text", async () => {
			const prompt = vi.spyOn(session, "prompt").mockResolvedValue(undefined);
			expect(await run("/notice")).toEqual({ consumed: true, failed: true });
			expect(output).toEqual(["Usage: /notice <text>"]);
			expect(prompt).not.toHaveBeenCalled();
		});
	});
});
