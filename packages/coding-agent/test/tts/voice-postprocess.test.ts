import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AssistantMessage, Model, StopReason } from "@oh-my-pi/pi-ai";
import * as ai from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SpeechEnhancer } from "@oh-my-pi/pi-coding-agent/tts/speech-enhancer";

const authStorages: AuthStorage[] = [];
const configDirs: string[] = [];

async function setup(role: "tiny" | "smol" = "tiny") {
	const model = getBundledModel("anthropic", "claude-haiku-4-5");
	if (!model) throw new Error("Expected bundled Claude Haiku 4.5 model");
	const settings = Settings.isolated({ modelRoles: { [role]: `${model.provider}/${model.id}` } });
	const authStorage = await AuthStorage.create(":memory:");
	authStorages.push(authStorage);
	authStorage.keys.setRuntime(model.provider, "test-key");
	const scratch = path.join(os.homedir(), ".cache", "npi-canary");
	await fs.mkdir(scratch, { recursive: true });
	const configDir = await fs.mkdtemp(path.join(scratch, "voice-postprocess-"));
	configDirs.push(configDir);
	const registry = new ModelRegistry(authStorage, path.join(configDir, "models.yml"), { settings });
	vi.spyOn(registry, "getAvailable").mockReturnValue([model]);
	const metadata = { voice: "test" };
	const metadataResolver = vi.fn(() => metadata);
	const enhancer = new SpeechEnhancer({ settings, registry, sessionId: "voice-session", metadataResolver });
	return { enhancer, registry, model, metadata, metadataResolver };
}

function response(model: Model, text: string, stopReason: StopReason = "stop"): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [{ type: "text", text }],
		stopReason,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: Date.now(),
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	for (const storage of authStorages.splice(0)) storage.close();
	await Promise.all(configDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("whole-reply voice postprocessing", () => {
	it.each(["tiny", "smol"] as const)(
		"reuses the %s role, credentials and metadata without truncating the reply",
		async role => {
			const { enhancer, registry, model, metadata, metadataResolver } = await setup(role);
			const getApiKey = vi.spyOn(registry, "getApiKey");
			metadataResolver.mockImplementation(() => {
				expect(getApiKey).toHaveBeenCalledWith(model, "voice-session");
				return metadata;
			});
			const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue(response(model, "  Spoken reply.  "));
			const text = "First paragraph.\n\n" + "Long reply with details. ".repeat(300) + "\n\nFinal paragraph.";
			const instruction = "Keep <names> & commands, and speak plainly.";

			expect(await enhancer.postprocess(text, instruction)).toBe("Spoken reply.");
			expect(complete).toHaveBeenCalledTimes(1);
			const call = complete.mock.calls[0];
			expect(call?.[0]).toBe(model);
			expect(call?.[1].messages).toEqual([{ role: "user", content: text, timestamp: expect.any(Number) }]);
			expect(call?.[1].systemPrompt).toEqual([expect.stringContaining(instruction)]);
			expect(call?.[1].systemPrompt?.join("\n")).not.toContain(text);
			expect(call?.[2]).toMatchObject({ metadata, sessionId: "voice-session", disableReasoning: true });
			expect(metadataResolver).toHaveBeenCalledWith(model.provider);
		},
	);

	it.each(["length", "toolUse", "error", "aborted"] as const)(
		"rejects a %s completion even when it contains text",
		async stopReason => {
			const { enhancer, model } = await setup();
			vi.spyOn(ai, "completeSimple").mockResolvedValue(response(model, "Partial spoken reply", stopReason));
			expect(await enhancer.postprocess("Full reply", "Summarize it.")).toBeNull();
		},
	);

	it.each(["", " \n\t "])("falls back for empty spoken output %j", async text => {
		const { enhancer, model } = await setup();
		vi.spyOn(ai, "completeSimple").mockResolvedValue(response(model, text));
		expect(await enhancer.postprocess("Full reply", "Summarize it.")).toBeNull();
	});

	it("falls back when completion rejects", async () => {
		const { enhancer } = await setup();
		vi.spyOn(ai, "completeSimple").mockRejectedValue(new Error("invalid request"));
		expect(await enhancer.postprocess("Full reply", "Summarize it.")).toBeNull();
	});

	it("falls back when credential lookup fails", async () => {
		const { enhancer, registry } = await setup();
		vi.spyOn(registry, "getApiKey").mockRejectedValue(new Error("credential lookup failed"));
		const complete = vi.spyOn(ai, "completeSimple");
		expect(await enhancer.postprocess("Full reply", "Summarize it.")).toBeNull();
		expect(complete).not.toHaveBeenCalled();
	});

	it("falls back when no credential resolves", async () => {
		const { enhancer, registry } = await setup();
		vi.spyOn(registry, "getApiKey").mockResolvedValue(undefined);
		const complete = vi.spyOn(ai, "completeSimple");
		expect(await enhancer.postprocess("Full reply", "Summarize it.")).toBeNull();
		expect(complete).not.toHaveBeenCalled();
	});

	it("skips a request that was already aborted", async () => {
		const { enhancer } = await setup();
		const complete = vi.spyOn(ai, "completeSimple");
		expect(await enhancer.postprocess("Reply", "Speak plainly.", AbortSignal.abort())).toBeNull();
		expect(complete).not.toHaveBeenCalled();
	});

	it("discards a successful response arriving after caller cancellation", async () => {
		const { enhancer, model } = await setup();
		const controller = new AbortController();
		vi.spyOn(ai, "completeSimple").mockImplementation(async (_model, _context, options) => {
			controller.abort();
			expect(options?.signal?.aborted).toBe(true);
			return response(model, "Late reply");
		});
		expect(await enhancer.postprocess("Reply", "Speak plainly.", controller.signal)).toBeNull();
	});

	it("discards a successful response arriving after the completion deadline", async () => {
		const { enhancer, model } = await setup();
		const timeout = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
		vi.spyOn(ai, "completeSimple").mockImplementation(async () => {
			timeout.abort();
			return response(model, "Late reply");
		});
		expect(await enhancer.postprocess("Reply", "Speak plainly.")).toBeNull();
	});

	it("keeps block rewriting bounded and preserves its intentional empty output", async () => {
		const { enhancer, model } = await setup();
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue(response(model, ""));
		const text = "x".repeat(6000);
		expect(await enhancer.rewrite(text)).toBe("");
		expect(complete.mock.calls[0]?.[1].messages[0]?.content).not.toBe(text);
	});
});
