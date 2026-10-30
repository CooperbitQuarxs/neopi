import { describe, expect, it } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Api, ModelSpec } from "@oh-my-pi/pi-catalog/types";

function spec<TApi extends Api>(provider: string, api: TApi): ModelSpec<TApi> {
	return {
		id: "gpt-4o-mini",
		name: "GPT-4o mini",
		provider,
		api,
		baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "https://proxy.example/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

describe("endpoint sampling parameter capabilities", () => {
	it("keeps temperature available but rejects unsupported OpenAI Chat Completions extensions", () => {
		const model = buildModel(spec("openai", "openai-completions"));
		expect(model.compat.supportsSamplingParams).toBe(true);
		expect(model.compat.unsupportedSamplingParams).toEqual(["topK", "minP", "repetitionPenalty"]);
	});

	it("also withholds penalty fields on first-party Responses", () => {
		const model = buildModel(spec("openai", "openai-responses"));
		expect(model.compat.supportsSamplingParams).toBe(true);
		expect(model.compat.unsupportedSamplingParams).toEqual([
			"topK",
			"minP",
			"presencePenalty",
			"repetitionPenalty",
			"frequencyPenalty",
		]);
	});

	it("does not apply first-party restrictions to a compatible proxy", () => {
		const model = buildModel(spec("custom-proxy", "openai-completions"));
		expect(model.compat.supportsSamplingParams).toBe(true);
		expect(model.compat.unsupportedSamplingParams).toBeUndefined();
	});

	it("honors explicit endpoint capability overrides", () => {
		const model = buildModel({
			...spec("openai", "openai-completions"),
			compat: { unsupportedSamplingParams: [] },
		});
		expect(model.compat.unsupportedSamplingParams).toEqual([]);
	});
});
