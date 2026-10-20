import { describe, expect, it } from "bun:test";
import { stream, streamSimple } from "@oh-my-pi/pi-ai/stream";
import type { StreamOptions } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelSpec } from "@oh-my-pi/pi-catalog/types";

const context = { messages: [{ role: "user" as const, content: "hi", timestamp: 0 }] };
const options: StreamOptions = {
	apiKey: "test-key",
	temperature: 0.2,
	topP: 0.8,
	topK: 40,
	minP: 0.05,
	presencePenalty: 0.5,
	repetitionPenalty: 1.1,
	frequencyPenalty: 0.4,
};

function modelSpec(provider: string): ModelSpec<"openai-completions"> {
	return {
		id: "gpt-4o-mini",
		name: "GPT-4o mini",
		api: "openai-completions",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

async function payload(spec: ModelSpec<"openai-completions">, simple: boolean): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const requestOptions: StreamOptions = {
		...options,
		fetch: async () => new Response(new Uint8Array(), { status: 200 }),
		onPayload: body => {
			captured = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
		},
	};
	const model = buildModel(spec);
	await (simple ? streamSimple(model, context, requestOptions) : stream(model, context, requestOptions)).result();
	if (!captured) throw new Error("No request payload was built");
	return captured;
}

describe.each([true, false])("endpoint sampling capability filtering, simple=%s", simple => {
	it("drops only unsupported fields and leaves caller options untouched", async () => {
		const body = await payload(modelSpec("openai"), simple);
		expect(body.temperature).toBe(0.2);
		expect(body.top_p).toBe(0.8);
		expect(body.presence_penalty).toBe(0.5);
		if (!simple) expect(body.frequency_penalty).toBe(0.4);
		for (const key of ["top_k", "min_p", "repetition_penalty"]) expect(body).not.toHaveProperty(key);
		expect(options.topK).toBe(40);
		expect(options.minP).toBe(0.05);
		expect(options.repetitionPenalty).toBe(1.1);
	});

	it("preserves supported proxy parameters", async () => {
		const body = await payload(modelSpec("custom-proxy"), simple);
		expect(body.top_k).toBe(40);
		expect(body.min_p).toBe(0.05);
		expect(body.repetition_penalty).toBe(1.1);
	});

	it("lets an explicit capability override enable endpoint extensions", async () => {
		const body = await payload({ ...modelSpec("openai"), compat: { unsupportedSamplingParams: [] } }, simple);
		expect(body.top_k).toBe(40);
		expect(body.min_p).toBe(0.05);
		expect(body.repetition_penalty).toBe(1.1);
	});
});
