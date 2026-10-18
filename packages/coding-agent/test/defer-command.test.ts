import { afterEach, describe, expect, it, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { parseDeferredInput } from "@oh-my-pi/pi-coding-agent/neopi/defer";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { lookupBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { CustomEditor } from "@oh-my-pi/pi-tui/prompt/custom-editor";
import { getEditorTheme } from "@oh-my-pi/pi-tui/theme";
import { TempDir } from "@oh-my-pi/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.restoreAllMocks();
});

function harness() {
	const temp = TempDir.createSync("@pi-defer-");
	const auth = createInMemoryAuthStorage();
	auth.keys.setRuntime("anthropic", "test-key");
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected bundled test model");
	const mock = createMockModel({ handler: { content: ["Acknowledged"] } });
	const manager = SessionManager.inMemory(temp.path());
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [] },
			streamFn: mock.stream,
		}),
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	cleanups.push(async () => {
		await session.dispose();
		auth.close();
		temp.removeSync();
	});
	const editor = new CustomEditor(getEditorTheme());
	const ctx = createInteractiveModeContext({
		session,
		sessionManager: manager,
		settings: session.settings,
		editor,
		onInputCallback: undefined,
		handleTanCommand: vi.fn(async () => {}),
		flushPendingBashComponents: vi.fn(),
		withLocalSubmission: async <T>(_text: string, fn: () => Promise<T>): Promise<T> => await fn(),
		isKnownSlashCommand: text => lookupBuiltinSlashCommand(text.slice(1).split(/\s|:/, 1)[0] ?? "") !== undefined,
		slashCommandNames: new Set(["defer", "tan"]),
		skillCommands: new Map(),
		fileSlashCommands: new Set(),
		locallySubmittedUserSignatures: new Set(),
		compactionQueuedMessages: [],
	});
	new InputController(ctx).setupEditorSubmitHandler();
	return { ctx, editor, session, mock, submit: async (text: string) => await editor.onSubmit?.(text) };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 20_000;
	while (!predicate() && performance.now() < deadline) await Bun.sleep(5);
	expect(predicate()).toBe(true);
}

describe("/defer", () => {
	it("accepts all units, fractional numbers and case-sensitive months and years", () => {
		for (const [duration, delayMs] of [
			["2ms", 2],
			[".5s", 500],
			["1m", 60_000],
			["1h", 3_600_000],
			["1d", 86_400_000],
			["1w", 604_800_000],
			["1M", 2_592_000_000],
			["1Y", 31_536_000_000],
		] as const)
			expect(parseDeferredInput(`${duration} hi\nthere`)).toEqual({ delayMs, input: "hi\nthere" });
		for (const input of ["10 hi", "1S hi", "1m", "1m   ", "1e999s hi"])
			expect(parseDeferredInput(input)).toBeUndefined();
	});

	it("delivers plain input through the normal composer path without consuming a newer draft or its images", async () => {
		const h = harness();
		await h.submit("/defer 5ms delayed prose");
		h.editor.setText("new draft");
		const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };
		h.editor.pendingImages = [image];
		await waitUntil(() => h.mock.calls.length === 1);
		expect(h.session.messages).toContainEqual(
			expect.objectContaining({
				role: "user",
				content: [{ type: "text", text: "delayed prose" }],
			}),
		);
		expect(h.editor.getText()).toBe("new draft");
		expect(h.editor.pendingImages).toEqual([image]);
	});

	it("executes deferred slash commands through the same interpreter", async () => {
		const h = harness();
		const tan = vi.spyOn(h.ctx, "handleTanCommand").mockResolvedValue();
		await h.submit("/defer 5ms /tan finish the task");
		await waitUntil(() => tan.mock.calls.length === 1);
		expect(tan).toHaveBeenCalledWith("finish the task");
		expect(h.mock.calls).toHaveLength(0);
	});

	it("preserves a deferred literal command's whitespace and unexpanded payload", async () => {
		const h = harness();
		const prompt = vi.spyOn(h.session, "prompt").mockResolvedValue(true);
		const payload = "  hi :) {{literal}}\nlast  ";
		await h.submit(`/defer 5ms /notice ${payload}`);
		await waitUntil(() => prompt.mock.calls.length === 1);
		expect(prompt.mock.calls[0]?.[0]).toBe(`<system-notice>\n${payload}\n</system-notice>`);
	});

	it("uses AgentSession's existing busy-message queue", async () => {
		const h = harness();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		h.mock.fallback = async () => {
			entered.resolve();
			await release.promise;
			return { content: ["Acknowledged"] };
		};
		const running = h.session.prompt("hold this turn");
		await entered.promise;
		try {
			await h.submit("/defer 5ms queued prose");
			await waitUntil(() => h.session.getQueuedMessages().steering.includes("queued prose"));
		} finally {
			release.resolve();
			await running;
		}
	});

	it("cancels individual and all timers, including delays beyond the platform timer limit", async () => {
		const h = harness();
		await h.submit("/defer 1Y /tan too soon");
		await h.submit("/defer 10ms /tan cancelled");
		await h.submit("/defer cancel 2");
		await Bun.sleep(30);
		expect(h.ctx.handleTanCommand).not.toHaveBeenCalled();
		await h.submit("/defer cancel all");
	});

	it("cancels pending submissions at disposal and conversation changes", async () => {
		for (const end of ["dispose", "newSession"] as const) {
			const h = harness();
			await h.submit("/defer 30ms /tan stale");
			if (end === "dispose") h.session.beginDispose();
			else await h.session.newSession();
			await Bun.sleep(60);
			expect(h.ctx.handleTanCommand).not.toHaveBeenCalled();
		}
	});
});
