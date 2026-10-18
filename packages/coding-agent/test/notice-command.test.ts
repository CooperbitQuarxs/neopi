import { afterEach, describe, expect, it, vi } from "bun:test";
import { Agent, type AgentMessage } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { submitInteractiveInput } from "@oh-my-pi/pi-coding-agent/main";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { SubmittedUserInput } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	BUILTIN_SLASH_COMMANDS,
	executeBuiltinSlashCommand,
	lookupBuiltinSlashCommand,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { TempDir } from "@oh-my-pi/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap(part => (part.type === "text" && "text" in part ? [part.text] : [])).join("");
}

function expectNotice(messages: readonly AgentMessage[], payload: string): void {
	const matching = messages.filter(message => textOf(message) === `<system-notice>\n${payload}\n</system-notice>`);
	expect(matching).toHaveLength(1);
	expect(matching[0]).toMatchObject({ role: "developer", attribution: "user", synthetic: true, userInitiated: true });
}

describe("/notice operator command", () => {
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	function createHarness(persist = false) {
		const temp = TempDir.createSync("@pi-notice-");
		const auth = createInMemoryAuthStorage();
		auth.keys.setRuntime("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled test model");
		const mock = createMockModel({ handler: { content: ["Acknowledged"] } });
		const manager = persist ? SessionManager.create(temp.path(), temp.path()) : SessionManager.inMemory(temp.path());
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [] },
			convertToLlm,
			streamFn: mock.stream,
		});
		const session = new AgentSession({
			agent,
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		cleanups.push(async () => {
			await session.dispose();
			auth.close();
			temp.removeSync();
		});
		let submission: SubmittedUserInput | undefined;
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			skillCommands: new Map(),
			optimisticSkillMessagePending: false,
			renderOptimisticSkillMessage: vi.fn(),
			clearOptimisticSkillMessage: vi.fn(),
		};
		const ctx = createInteractiveModeContext({
			session,
			sessionManager: manager,
			settings: session.settings,
			onInputCallback: input => {
				submission = input;
			},
			isKnownSlashCommand: text => lookupBuiltinSlashCommand(text.slice(1).split(/\s|:/, 1)[0] ?? "") !== undefined,
			slashCommandNames: new Set(["notice"]),
			skillCommands: new Map(),
			fileSlashCommands: new Set(),
			editor: {
				pendingImages: [],
				pendingImageLinks: [],
				composerChips: () => [],
				addToHistory: vi.fn(),
				clearSubmittedDraft: vi.fn(),
				setCollapsedText: vi.fn(),
				setActionKeys: vi.fn(),
				setCustomKeyHandler: vi.fn(),
				clearCustomKeyHandlers: vi.fn(),
			},
		});
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		async function submit(text: string): Promise<void> {
			await ctx.editor.onSubmit?.(text);
		}
		async function dispatch(): Promise<void> {
			if (!submission) throw new Error("Expected foreground input submission");
			const input = submission;
			submission = undefined;
			await submitInteractiveInput(mode, session, input);
			expect(mode.showError).not.toHaveBeenCalled();
		}
		return { ctx, session, manager, mock, mode, controller, submit, dispatch, getSubmission: () => submission };
	}

	it("preserves literal multiline payload, developer role and operator attribution through disk replay", async () => {
		const harness = createHarness(true);
		const payload =
			"  first :) & <tag> 'quoted' $HOME $(printf x) `id` {{danger}} ^model\n\tsecond -> ...  \n\nlast  ";
		await harness.submit(`/notice ${payload}`);
		expect(harness.mock.calls).toHaveLength(0);
		await harness.dispatch();
		expectNotice(harness.mock.calls[0].context.messages, payload);
		expectNotice(harness.session.messages, payload);
		expect(harness.ctx.editor.addToHistory).toHaveBeenCalledWith(`/notice ${payload}`);
		await harness.manager.flush();
		const file = harness.manager.getSessionFile();
		if (!file) throw new Error("Expected persisted session file");
		const stored = (await Bun.file(file).text())
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line) as { type: string; message?: AgentMessage });
		expectNotice(
			stored.flatMap(entry => (entry.type === "message" && entry.message ? [entry.message] : [])),
			payload,
		);
		await harness.session.dispose();
		const reopened = await SessionManager.open(file);
		try {
			expectNotice(reopened.buildSessionContext().messages, payload);
			expectNotice(convertToLlm(reopened.buildSessionContext().messages), payload);
		} finally {
			await reopened.close();
		}
	});

	it("starts a real turn between input waiters instead of losing the notice", async () => {
		const harness = createHarness();
		harness.ctx.onInputCallback = undefined;
		await harness.submit("/notice between turns");
		expectNotice(harness.mock.calls[0].context.messages, "between turns");
	});

	it("keeps notice payloads literal when submitted with the follow-up chord", async () => {
		const harness = createHarness();
		const payload = "  follow-up :) {{literal}}\nsecond line  ";
		harness.ctx.editor.getExpandedText = () => `/notice ${payload}`;
		await harness.controller.handleFollowUp();
		await harness.dispatch();
		expectNotice(harness.mock.calls[0].context.messages, payload);
	});

	it("steers a busy turn as a developer notice and persists the delivered role", async () => {
		const harness = createHarness();
		let injected = false;
		harness.session.agent.setOnBeforeYield(async () => {
			if (injected) return;
			injected = true;
			expect(harness.session.isStreaming).toBe(true);
			await harness.submit("/notice busy\nsecond line");
		});
		await harness.session.prompt("initial user turn");
		expect(injected).toBe(true);
		expect(harness.mock.calls).toHaveLength(2);
		expectNotice(harness.mock.calls[1].context.messages, "busy\nsecond line");
		expectNotice(harness.manager.buildSessionContext().messages, "busy\nsecond line");
		expect(harness.session.agent.hasQueuedMessages()).toBe(false);
		expect(harness.getSubmission()).toBeUndefined();
	});

	it("keeps the developer role when an idle submission races another prompt's preflight", async () => {
		const harness = createHarness();
		await harness.submit("/notice raced notice");
		await Promise.all([
			harness.session.prompt("concurrent initial prompt", { streamingBehavior: "steer" }),
			harness.dispatch(),
		]);
		expectNotice(harness.session.messages, "raced notice");
		expectNotice(harness.mock.calls.at(-1)!.context.messages, "raced notice");
	});

	for (const streamingBehavior of ["steer", "followUp"] as const) {
		it(`preserves synthetic metadata in the existing ${streamingBehavior} queue`, async () => {
			const harness = createHarness();
			let injected = false;
			harness.session.agent.setOnBeforeYield(async () => {
				if (injected) return;
				injected = true;
				await harness.session.prompt("<system-notice>\nqueued\n</system-notice>", {
					synthetic: true,
					userInitiated: true,
					attribution: "user",
					expandPromptTemplates: false,
					streamingBehavior,
				});
			});
			await harness.session.prompt("initial");
			expectNotice(harness.mock.calls.at(-1)!.context.messages, "queued");
		});
	}

	it("registers completion and help while empty notices send no model turn", async () => {
		const harness = createHarness();
		const command = BUILTIN_SLASH_COMMANDS.find(command => command.name === "notice");
		expect(command?.description).toContain("operator-authored");
		expect(command?.getInlineHint?.("")).toBe("<text>");
		for (const command of ["/notice", "/notice \n\t  "]) await harness.submit(command);
		expect(harness.ctx.showStatus).toHaveBeenCalledWith("Usage: /notice <text>");
		expect(harness.getSubmission()).toBeUndefined();
		expect(harness.mock.calls).toHaveLength(0);
		expect(harness.session.messages).toHaveLength(0);
		expect(await executeBuiltinSlashCommand("/noticeboard not a notice", { ctx: harness.ctx })).toBe(false);
	});
});
