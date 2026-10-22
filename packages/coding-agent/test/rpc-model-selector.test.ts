import { describe, expect, test } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import {
	buildSessionModelScope,
	ModelBrowser,
	type ModelBrowserPerf,
	type ModelBrowserSource,
} from "@oh-my-pi/pi-tui/overlays/model-browser";
import { Settings } from "../src/config/settings";
import { ModelRegistry } from "../src/config/model-registry";
import { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { createModelBrowserSource } from "../src/modes/model-browser-source";
import { getRpcModelSelector, queryModelSelector } from "../src/modes/rpc/rpc-model-selector";

function model(provider: string, id: string): Model {
	return buildModel({
		provider, id, name: id, api: "ollama-chat", baseUrl: "https://example.invalid",
		reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096,
		cost: { input: 2, output: 8, cacheRead: 0, cacheWrite: 0 },
	});
}

const registry = (models: Model[]) => ({
	getAll: () => models,
	getAvailable: () => models,
	getError: () => undefined,
});

describe("read-only native model selector", () => {
	test("querying a connected session leaves its selected model, transcript and role configuration untouched", async () => {
		const auth = createInMemoryAuthStorage();
		auth.keys.setRuntime("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(auth);
		const selected = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!selected) throw new Error("Expected bundled claude-sonnet-4-5");
		const settings = Settings.isolated({ modelRoles: { default: "anthropic/claude-sonnet-4-5" } });
		const manager = SessionManager.inMemory();
		const session = new AgentSession({
			agent: new Agent({ initialState: { model: selected, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: manager, settings, modelRegistry,
			scopedModels: [{ model: selected }],
		});
		try {
			const entries = manager.getEntries();
			const roles = settings.getModelRoles();
			const sessionId = session.sessionId;
			const result = await getRpcModelSelector(session, "sonnet");
			expect(result.items.map(item => item.selector)).toEqual(["anthropic/claude-sonnet-4-5"]);
			expect(session.model).toBe(selected);
			expect(session.sessionId).toBe(sessionId);
			expect(manager.getEntries()).toEqual(entries);
			expect(settings.getModelRoles()).toEqual(roles);
		} finally {
			await session.dispose();
			auth.close();
		}
	});

	test("plain queries retain native fuzzy matching and provider/role/MRU order", () => {
		const models = [model("alpha", "example-2"), model("beta", "example-2"), model("alpha", "unrelated")];
		const settings = Settings.isolated({ modelRoles: { default: "beta/example-2" }, modelProviderOrder: ["beta", "alpha"] });
		const source: ModelBrowserSource = {
			...createModelBrowserSource(settings),
			mruOrder: ["alpha/unrelated"],
		};
		const catalog = registry(models);
		const scope = buildSessionModelScope(source, catalog, []);
		const picker = new ModelBrowser(source);
		picker.setRoles(scope.roles);
		picker.setMruOrder(scope.mruOrder);
		picker.setItems(scope.items);
		for (const query of ["", "example", "exmp2", "beta", "no-such-model"]) {
			picker.setQuery(query);
			expect(queryModelSelector(source, catalog, [], query).items.map(item => item.selector))
				.toEqual((picker.queryMatches ?? scope.items).map(item => item.selector));
		}
		expect(queryModelSelector(source, catalog, [], "example").items.map(item => item.selector))
			.toEqual(["beta/example-2", "alpha/example-2"]);
	});

	test("the enabled session scope excludes other concrete models and preserves role aliases", () => {
		const active = model("native", "enabled");
		const excluded = model("native", "excluded");
		const settings = Settings.isolated({ modelRoles: { default: "native/enabled", reviewer: "native/enabled" } });
		const before = settings.getModelRoles();
		const result = queryModelSelector(createModelBrowserSource(settings), registry([active, excluded]), [active], "");
		expect(result.items.map(item => item.selector)).toEqual(["native/enabled"]);
		expect(result.roles.find(item => item.selector === "@reviewer"))
			.toMatchObject({ id: "reviewer", resolvedSelector: "native/enabled" });
		expect(settings.getModelRoles()).toEqual(before);
	});

	test("row facts use the selected service tier and native effective maintenance budget", () => {
		const selected = model("native", "measured");
		selected.int = 43;
		selected.tps = 20;
		const perf = new Map<string, ModelBrowserPerf>([
			["native/measured", { samples: 4, tps: 30, ttftMs: 900 }],
			["native/measured@priority", { samples: 2, tps: 90, ttftMs: 150 }],
		]);
		const settings = Settings.isolated({ modelRoles: { default: "native/measured" } });
		const source: ModelBrowserSource = {
			...createModelBrowserSource(settings), modelPerf: perf,
			serviceTierFor: () => "priority", effectiveContextWindowFor: () => 50000,
		};
		const result = queryModelSelector(source, registry([selected]), [], "");
		expect(result.items[0]?.facts).toEqual({
			intelligence: 43, ttftMs: 150, tokensPerSecond: 90, contextWindow: 128000,
			effectiveContextWindow: 50000, inputCostPerMillion: 2, outputCostPerMillion: 8,
			performanceSource: "measured", serviceTier: "priority",
		});
		expect(result.roles.find(item => item.selector === "@default")?.facts).toEqual(result.items[0]?.facts);
	});

	test("standard and fastest measured tier fallbacks agree with the native preview", () => {
		const selected = model("native", "fallback");
		const settings = Settings.isolated({});
		const perf = new Map<string, ModelBrowserPerf>([
			["native/fallback@flex", { samples: 2, tps: 40, ttftMs: null }],
			["native/fallback@priority", { samples: 1, tps: 80, ttftMs: 200 }],
		]);
		const source: ModelBrowserSource = { ...createModelBrowserSource(settings), modelPerf: perf };
		expect(queryModelSelector(source, registry([selected]), [], "").items[0]?.facts)
			.toMatchObject({ tokensPerSecond: 80, ttftMs: 200, serviceTier: "priority" });
		perf.set("native/fallback", { samples: 5, tps: 50, ttftMs: 700 });
		expect(queryModelSelector(source, registry([selected]), [], "").items[0]?.facts)
			.toMatchObject({ tokensPerSecond: 50, ttftMs: 700, serviceTier: null });
	});

	test("absent catalog and measured metrics remain unknown, while actual free costs remain zero", () => {
		const selected = model("native", "unknown");
		selected.cost.input = 0;
		selected.cost.output = 0;
		const source = createModelBrowserSource(Settings.isolated({}));
		const result = queryModelSelector(source, registry([selected]), [], "");
		expect(result.items[0]?.facts).toMatchObject({
			intelligence: null, ttftMs: null, tokensPerSecond: null,
			inputCostPerMillion: 0, outputCostPerMillion: 0, performanceSource: null, serviceTier: null,
		});
	});
});
