import { afterEach, expect, spyOn, test } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentMessage, type AgentPromptOptions } from "@oh-my-pi/pi-agent-core";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	cfgChroniclerCaptureCarryChars,
	cfgChroniclerCaptureMaterialCriteria,
	cfgChroniclerCaptureMaxWords,
	cfgChroniclerCaptureMinWords,
	cfgChroniclerCapturePrefixEntries,
	cfgChroniclerCaptureReadPageMax,
	cfgChroniclerCaptureReadPageSize,
	cfgChroniclerCaptureReadTitleChars,
	chroniclerCaptureSettings,
} from "../../src/chronicler/capture-settings";
import { FinishChronicleTool, getChroniclerToolSchemas, ReadChronicleTool } from "../../src/chronicler/chronicle-tool";
import { renderChroniclerSystemPrompt, SessionChronicler } from "../../src/chronicler/session-chronicler";
import { ChroniclerStore } from "../../src/chronicler/store";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { SessionManager } from "../../src/session/session-manager";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

const restores: (() => void)[] = [];
afterEach(() => {
	for (const restore of restores.splice(0).reverse()) restore();
});

test("capture defaults and prompt values resolve without process-wide Settings.init", () => {
	const settings = Settings.isolated({});
	for (const setting of chroniclerCaptureSettings) expect(setting.get(settings)).toEqual(setting.default);
	const descriptor = { sessionId: "session", cwd: "project" };
	const defaults = renderChroniclerSystemPrompt(descriptor, settings);
	expect(defaults).toContain("at least 2 of these three conditions");
	expect(defaults).toContain("Aim for 150–1,200 words");
	cfgChroniclerCaptureMaterialCriteria.override(settings, 3);
	cfgChroniclerCaptureMinWords.override(settings, 75);
	cfgChroniclerCaptureMaxWords.override(settings, 900);
	cfgChroniclerCaptureCarryChars.override(settings, 400);
	cfgChroniclerCaptureReadPageSize.override(settings, 7);
	cfgChroniclerCaptureReadPageMax.override(settings, 10);
	const changed = renderChroniclerSystemPrompt(descriptor, settings);
	expect(changed).toContain("at least 3 of these three conditions");
	expect(changed).toContain("Aim for 75–900 words");
	expect(changed).toContain("exactly one finish_chronicle call");
	const tools = getChroniclerToolSchemas(settings);
	expect(tools[1].description).toContain("at most 400 characters");
	expect(tools[2].description).toContain("default to 7 rows, with at most 10 rows");
	expect(tools[2].parameters.toJsonSchema()).toMatchObject({
		properties: { limit: { type: "integer", minimum: 1, maximum: 10 } },
	});
	expect(changed + tools.map(tool => tool.description).join("\n")).not.toContain("{{");
});

test("read paging, clipping and carry limits follow effective settings at execution", async () => {
	const temp = TempDir.createSync("chronicler-capture-settings-");
	try {
		const settings = Settings.isolated({});
		const store = new ChroniclerStore(
			temp.path(),
			{ sessionId: "session", project: "project", model: "mock" },
			{},
			false,
			settings,
		);
		await store.open();
		const source = { id: "source", parentId: null, timestamp: "2026-10-22T00:00:00.000Z" };
		const batch = store.beginBatch([source]);
		for (let index = 0; index < 3; index++) {
			store.stageBeat(batch, {
				title: `Long beat title ${index}`,
				kind: "decision",
				body: "Evidence.",
				topics: [],
				sources: [source.id],
				eventTime: source.timestamp,
				related: [],
			});
		}
		batch.finalized = true;
		await store.commitBatch(batch);
		const attempt = store.beginBatch([]);
		const reader = new ReadChronicleTool(store, attempt, undefined, settings);
		const initial = await reader.execute("initial", {});
		expect(initial.details).toEqual({ offset: 0, nextOffset: null, total: 3 });
		cfgChroniclerCaptureReadPageSize.override(settings, 2);
		cfgChroniclerCaptureReadPageMax.override(settings, 1);
		cfgChroniclerCaptureReadTitleChars.override(settings, 5);
		const changed = await reader.execute("changed", {});
		expect(changed.details).toEqual({ offset: 0, nextOffset: 1, total: 3 });
		const content = changed.content[0];
		if (content.type !== "text") throw new Error("Expected a metadata page");
		expect(JSON.parse(content.text).beats).toEqual([
			{ id: store.beats[2].id, title: "Long…", kind: "decision", eventTime: source.timestamp },
		]);
		await expect(reader.execute("oversized", { limit: 2 })).rejects.toThrow("through 1");
		const finish = new FinishChronicleTool(store, attempt, store.sourceEntries, settings);
		cfgChroniclerCaptureCarryChars.override(settings, 3);
		await expect(finish.execute("too-long", { carry: { sources: [source.id], text: "four" } })).rejects.toThrow(
			"3 characters",
		);
		cfgChroniclerCaptureCarryChars.override(settings, 4);
		await finish.execute("accepted", { carry: { sources: [source.id], text: "four" } });
		await store.commitBatch(attempt);
		expect(store.carry?.text).toBe("four");
	} finally {
		await temp.remove();
	}
});

test("capture setting changes rebind the session writer and resize the next pass", async () => {
	const temp = TempDir.createSync("chronicler-capture-rebind-");
	const auth = createInMemoryAuthStorage();
	let runtime: SessionChronicler | undefined;
	try {
		auth.keys.setRuntime("mock", "test-key");
		const model = createMockModel({ id: "capture-settings", provider: "mock", contextWindow: 200_000 });
		const registry = new ModelRegistry(auth);
		const registrySpy = spyOn(registry, "getAvailable").mockImplementation(() => [model]);
		restores.push(() => registrySpy.mockRestore());
		const settings = Settings.isolated({ "chronicler.enabled": true });
		settings.setModelRole("chronicler", "mock/capture-settings");
		cfgChroniclerCapturePrefixEntries.override(settings, 1);
		const manager = SessionManager.create(temp.path(), path.join(temp.path(), "sessions"));
		await manager.ensureOnDisk();
		manager.appendMessage({ role: "user", content: "First material decision.", timestamp: Date.now() });
		manager.appendMessage({ role: "user", content: "Second material decision.", timestamp: Date.now() });
		const passes: { agent: Agent; input: string; system: string }[] = [];
		const originalPrompt = Agent.prototype.prompt;
		const promptSpy = spyOn(Agent.prototype, "prompt");
		restores.push(() => promptSpy.mockRestore());
		promptSpy.mockImplementation(async function (
			this: Agent,
			input: string | AgentMessage | AgentMessage[],
			imagesOrOptions?: ImageContent[] | AgentPromptOptions,
			options?: AgentPromptOptions,
		): Promise<void> {
			if (this.state.tools.some(tool => tool.name === "finish_chronicle")) {
				passes.push({ agent: this, input: JSON.stringify(input), system: this.state.systemPrompt.join("\n") });
				const mock = createMockModel({
					responses: [
						{ content: [{ type: "toolCall", name: "finish_chronicle", arguments: { carry: null } }] },
						{ content: ["Finished."], stopReason: "stop" },
					],
				});
				this.streamFn = mock.stream;
			}
			if (typeof input === "string")
				return originalPrompt.call(this, input, imagesOrOptions as ImageContent[] | undefined, options);
			const promptMessages: (input: AgentMessage | AgentMessage[], options?: AgentPromptOptions) => Promise<void> =
				originalPrompt;
			return promptMessages.call(this, input, imagesOrOptions as AgentPromptOptions | undefined);
		});
		runtime = new SessionChronicler({
			agent: new Agent({ initialState: { model } }),
			sessionManager: manager,
			settings,
			modelRegistry: registry,
			obfuscator: undefined,
			providerSessionState: new Map(),
			preferWebsockets: undefined,
			isDisposed: () => false,
			isCaptureEligible: () => true,
			emitNotice: () => {},
			cwd: () => temp.path(),
		});
		await runtime.idle();
		expect(passes).toHaveLength(2);
		for (const pass of passes) expect([...pass.input.matchAll(/### Source entry/g)]).toHaveLength(1);
		manager.appendMessage({ role: "user", content: "Third decision.", timestamp: Date.now() });
		manager.appendMessage({ role: "user", content: "Fourth decision.", timestamp: Date.now() });
		cfgChroniclerCapturePrefixEntries.override(settings, 2);
		cfgChroniclerCaptureMaterialCriteria.override(settings, 3);
		await runtime.idle();
		expect(passes).toHaveLength(3);
		expect([...passes[2].input.matchAll(/### Source entry/g)]).toHaveLength(2);
		expect(passes[2].agent).not.toBe(passes[0].agent);
		expect(passes[2].system).toContain("at least 3 of these three conditions");
	} finally {
		await runtime?.drain(3_000);
		auth.close();
		await temp.remove();
	}
});
