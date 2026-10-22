import { describe, expect, test } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { loadModelFactSources } from "../src/config/model-fact-sources";
import { resolveModelFacts } from "../src/config/model-facts";

const target = buildModel({
	id: "grok-4.7",
	name: "Grok 4.7",
	provider: "xai-oauth",
	api: "openai-responses",
	baseUrl: "https://api.x.ai/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: null,
	maxTokens: null,
});

describe("model fact source adapters", () => {
	test("a failed public source does not prevent stencil from supplying a newly listed model", async () => {
		const sources = await loadModelFactSources(["openrouter", "stencil"], "online", {
			cacheDbPath: ":memory:",
			fetch: async input => {
				if (!String(input).includes("catalog.stencil.so")) throw new Error("public catalog unavailable");
				return Response.json({
					xai: {
						models: {
							"grok-4.7": {
								id: "grok-4.7",
								name: "Grok 4.7",
								reasoning: true,
								tool_call: true,
								limit: { context: 500000, output: 32000 },
								cost: { input: 2, output: 6 },
								reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
							},
						},
					},
				});
			},
			providerModels: async () => {
				throw new Error("unexpected provider");
			},
		});
		expect(sources[0].models).toHaveLength(0);
		expect(sources[1].models.some(model => model.id === "grok-4.7")).toBe(true);
		const resolved = resolveModelFacts(target, sources);
		expect(resolved.model.contextWindow).toBe(500000);
		expect(resolved.model.cost.input).toBe(2);
		expect(resolved.provenance.contextWindow).toMatchObject({ kind: "source", source: "stencil" });
	});

	test("offline source loading never fetches public catalogs and keeps the previous stencil snapshot", async () => {
		let requests = 0;
		const previous = [{ source: "stencil", models: [target] }];
		const loaded = await loadModelFactSources(
			["stencil"],
			"offline",
			{
				fetch: async () => {
					requests++;
					throw new Error("unexpected network");
				},
				providerModels: async () => [],
			},
			previous,
		);
		expect(requests).toBe(0);
		expect(loaded[0]).toBe(previous[0]);
	});

	test("configured provider names use the registry discovery contract without a compiled-in adapter", async () => {
		const calls: string[] = [];
		const loaded = await loadModelFactSources(["extension-only", "failed-extension"], "online-if-uncached", {
			fetch: async () => {
				throw new Error("unexpected network");
			},
			providerModels: async (provider, strategy) => {
				calls.push(`${provider}:${strategy}`);
				if (provider === "failed-extension") throw new Error("provider unavailable");
				return [target];
			},
		});
		expect(calls).toEqual(["extension-only:online-if-uncached", "failed-extension:online-if-uncached"]);
		expect(loaded[0].models).toEqual([target]);
		expect(loaded[1].models).toHaveLength(0);
	});

	test("an unreachable stencil source is skipped even after an earlier successful catalog fetch", async () => {
		let down = false;
		const host = {
			fetch: async () => {
				if (down) throw new Error("stencil unavailable");
				return Response.json({
					xai: {
						models: {
							"grok-4.7": {
								id: "grok-4.7",
								name: "Grok 4.7",
								tool_call: true,
								limit: { context: 500000, output: 32000 },
								cost: { input: 2, output: 6 },
							},
						},
					},
				});
			},
			providerModels: async () => [target],
		};
		const first = await loadModelFactSources(["stencil", "extension"], "online", host);
		expect(first[0].models.some(model => model.id === target.id)).toBe(true);
		down = true;
		const second = await loadModelFactSources(["stencil", "extension"], "online", host, first);
		expect(second[0].models).toHaveLength(0);
		expect(second[1].models).toEqual([target]);
	});
});
