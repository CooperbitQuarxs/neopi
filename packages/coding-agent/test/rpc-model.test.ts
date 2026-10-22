import { describe, expect, it } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { serializeRpcModel } from "../src/modes/rpc/rpc-model";
import { buildRpcSessionState, CONTROL_QUEUE_LIMIT } from "../src/modes/rpc/rpc-session-state";
import type { AgentSession } from "../src/session/agent-session";

function model(provider: string, api: Api, id: string, serviceTiers?: string[]): Model {
	return buildModel({
		id,
		name: id,
		provider,
		api,
		baseUrl: "https://provider.example/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
		contextWindow: 128_000,
		maxTokens: 16_000,
		...(serviceTiers === undefined ? {} : { serviceTiers }),
	});
}

const cases: [string, Model, boolean][] = [
	["OpenAI Responses", model("openai", "openai-responses", "gpt-5.5"), true],
	["OpenAI Completions", model("openai", "openai-completions", "gpt-5.5"), true],
	["Codex unreported tiers", model("openai-codex", "openai-codex-responses", "gpt-5.5"), true],
	["Codex empty tiers", model("openai-codex", "openai-codex-responses", "gpt-5.5", []), true],
	["Codex priority", model("openai-codex", "openai-codex-responses", "gpt-5.5", ["priority"]), true],
	["Codex default only", model("openai-codex", "openai-codex-responses", "gpt-5.5", ["default"]), false],
	["Codex Ultrafast only", model("openai-codex", "openai-codex-responses", "gpt-5.5", ["ultrafast"]), false],
	["Anthropic", model("anthropic", "anthropic-messages", "claude-opus-4-6"), true],
	["Bedrock Claude", model("amazon-bedrock", "anthropic-messages", "claude-opus-4-6"), false],
	["Vertex Claude", model("google-vertex", "anthropic-messages", "claude-opus-4-6"), false],
	["Gemini", model("google", "google-generative-ai", "gemini-3-flash"), true],
	["Vertex Gemini", model("google-vertex", "google-vertex", "gemini-3-flash"), true],
	["OpenRouter OpenAI", model("openrouter", "openai-completions", "openai/gpt-5.5"), true],
	["OpenRouter Gemini", model("openrouter", "openai-completions", "google/gemini-3-flash"), true],
	["OpenRouter Claude", model("openrouter", "openai-completions", "anthropic/claude-opus-4-6"), false],
	["OpenRouter other model", model("openrouter", "openai-completions", "z-ai/glm-4.7"), false],
	["custom OpenAI Responses", model("custom-relay", "openai-responses", "gpt-5.5"), true],
	["custom OpenAI Completions", model("custom-relay", "openai-completions", "gpt-5.5"), true],
	["custom Codex empty tiers", model("custom-relay", "openai-codex-responses", "gpt-5.5", []), true],
	["custom Codex without priority", model("custom-relay", "openai-codex-responses", "gpt-5.5", ["flex"]), false],
	["custom non-OpenAI model", model("custom-relay", "openai-completions", "qwen3"), false],
	["Copilot OpenAI model", model("github-copilot", "openai-responses", "gpt-5.5"), false],
	["Fireworks dedicated priority control", model("fireworks", "openai-completions", "gpt-oss-120b"), false],
];

/** The state builder only reads these session fields; no runtime or provider is started. */
function sessionFor(selectedModel: Model | undefined, fastModeEnabled: boolean, fastModeActive: boolean): AgentSession {
	const session = {
		model: selectedModel,
		thinkingLevel: "high",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "one-at-a-time",
		interruptMode: "immediate",
		sessionId: "rpc-model-test",
		autoCompactionEnabled: true,
		queuedMessageCount: 0,
		hasAdmittedSubmission: false,
		messages: [],
		getQueuedMessages: () => ({ steering: [], followUp: [], liveSteered: 0 }),
		hasPendingAsyncWork: () => false,
		getTodoPhases: () => [],
		isFastModeEnabled: () => fastModeEnabled,
		isFastModeActive: () => fastModeActive,
		isSlowModeSupported: () => false,
		isSlowModeEnabled: () => false,
		getSlowModeScope: () => undefined,
		getUsageLimitState: () => undefined,
		getContextUsage: () => undefined,
		getPlanModeState: () => undefined,
		getGoalModeState: () => undefined,
		systemPrompt: ["preserve the prompt"],
		agent: { state: { tools: [] } },
	};
	return session as AgentSession;
}

describe("RPC model serialization", () => {
	it.each(cases)("projects native Fast support for %s", (_name, source, expected) => {
		const frozen = Object.freeze(source);
		const projected = serializeRpcModel(frozen);
		expect(projected.supportsFastMode).toBe(expected);
		expect(projected).toEqual({ ...source, supportsFastMode: expected });
		expect(projected).not.toBe(source);
		expect(source).not.toHaveProperty("supportsFastMode");
	});

	it("preserves the descriptor payload and does not treat a fast SKU as a capability flag", () => {
		const source: Model = {
			...model("custom-relay", "openai-completions", "qwen3"),
			headers: { "x-project": "test" },
			compat: { fastMode: true },
		};
		const original = JSON.stringify(source);
		const payload = JSON.parse(JSON.stringify(serializeRpcModel(Object.freeze(source))));
		expect(payload).toEqual({ ...JSON.parse(original), supportsFastMode: false });
		expect(JSON.stringify(source)).toBe(original);
		expect(serializeRpcModel(source).headers).toBe(source.headers);
		expect(serializeRpcModel(source).compat).toBe(source.compat);
	});

	it.each(cases)("includes the same capability in RPC and control snapshots for %s", (_name, source, expected) => {
		const session = sessionFor(source, true, false);
		for (const options of [
			{ includeDump: true },
			{ includeDump: false, queueLimit: CONTROL_QUEUE_LIMIT },
		]) {
			const state = buildRpcSessionState(session, options);
			expect(state.model).toEqual({ ...source, supportsFastMode: expected });
			expect(state.fastModeEnabled).toBe(true);
			expect(state.fastModeActive).toBe(false);
			expect(source).not.toHaveProperty("supportsFastMode");
		}
	});

	it("keeps supported capability separate from an off session toggle", () => {
		const source = model("openai", "openai-responses", "gpt-5.5");
		const state = buildRpcSessionState(sessionFor(source, false, false), { includeDump: true });
		expect(state.model?.supportsFastMode).toBe(true);
		expect(state.fastModeEnabled).toBe(false);
		expect(state.fastModeActive).toBe(false);
		expect(state.systemPrompt).toEqual(["preserve the prompt"]);
		expect(state.dumpTools).toEqual([]);
	});

	it("keeps no-model state absent on the wire and preserves realized Fast state", () => {
		const state = buildRpcSessionState(sessionFor(undefined, true, true), { includeDump: false });
		expect(state.model).toBeUndefined();
		expect(JSON.parse(JSON.stringify(state))).not.toHaveProperty("model");
		expect(state.fastModeEnabled).toBe(true);
		expect(state.fastModeActive).toBe(true);
	});
});
