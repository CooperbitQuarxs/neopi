import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { Agent, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { cfgModelRoleStorage } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import { cfgEffortRules } from "@oh-my-pi/pi-coding-agent/config/effort-policy";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { RpcModelsConfiguration } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-models-configuration";
import { RpcModelsCommands } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-models-commands";
import { RpcPendingExtensionRequests } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cfgCompactionEnabled, cfgCompactionThresholdTokens } from "@oh-my-pi/pi-coding-agent/session/context-settings";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

describe("native model configuration", () => {
	let auth: AuthStorage;
	let session: AgentSession;
	let settings: Settings;
	let configuration: RpcModelsConfiguration;
	beforeEach(() => {
		auth = createInMemoryAuthStorage();
		auth.keys.setRuntime("anthropic", "fixture-key-never-returned");
		const registry = new ModelRegistry(auth);
		const model = registry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Missing native test model");
		vi.spyOn(registry, "getAll").mockReturnValue([model]);
		vi.spyOn(registry, "getAvailable").mockReturnValue([model]);
		settings = Settings.isolated({ modelRoles: { default: `${model.provider}/${model.id}` } });
		cfgModelRoleStorage.set(settings, "project");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: [], tools: [], messages: [] } }),
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry: registry,
		});
		configuration = new RpcModelsConfiguration(session);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await session.dispose();
		auth.close();
	});

	test("scoped regex assignment uses native resolution, not the current model, and preserves the global role", async () => {
		const before = session.model;
		await configuration.setRole({
			role: "reviewer",
			scope: "global",
			selector: "anthropic/claude-sonnet-4-5",
			expected: { selector: null, effort: null },
		});
		await configuration.setRole({
			role: "reviewer",
			scope: "project",
			selector: "re:^anthropic/claude-sonnet-4-5$",
			effort: { mode: "auto", allowed: ["off", ThinkingLevel.Low] },
			expected: { selector: null, effort: null },
		});
		const role = (await configuration.read()).roles.find(role => role.id === "reviewer");
		expect(role).toMatchObject({
			provenance: "project",
			global: { selector: "anthropic/claude-sonnet-4-5" },
			project: { selector: "re:^anthropic/claude-sonnet-4-5$", effort: { mode: "auto", allowed: ["off", "low"] } },
			resolved: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
		});
		expect(session.model).toBe(before);
		await configuration.setRole({ role: "reviewer", scope: "project", expected: role!.project });
		expect(settings.getModelRole("reviewer")).toBe("anthropic/claude-sonnet-4-5");
	});

	test("a stale scoped role fails without replacing the newer value or effort", async () => {
		await configuration.setRole({
			role: "reviewer",
			scope: "global",
			selector: "anthropic/claude-sonnet-4-5",
			effort: { mode: "inherit" },
			expected: { selector: null, effort: null },
		});
		await expect(
			configuration.setRole({
				role: "reviewer",
				scope: "global",
				selector: "anthropic/*",
				expected: { selector: null, effort: null },
			}),
		).rejects.toMatchObject({ code: "configuration_conflict" });
		expect(settings.getGlobalRoleEffortSelection("reviewer")).toEqual({ mode: "inherit" });
		expect(settings.getGlobalModelRole("reviewer")).toBe("anthropic/claude-sonnet-4-5");
	});

	test("effort rules preserve off and scoped inheritance, and reject stale and invalid writes", async () => {
		const rules = [{ selector: "anthropic/*", allowed: ["off" as const, ThinkingLevel.Low] }];
		await configuration.setEffortRules({ scope: "global", rules, expected: null });
		await configuration.setEffortRules({
			scope: "project",
			rules: [{ selector: "re:^anthropic/", allowed: ["off"] }],
			expected: null,
		});
		expect(cfgEffortRules.get(settings)).toEqual([{ selector: "re:^anthropic/", allowed: ["off"] }]);
		await expect(configuration.setEffortRules({ scope: "project", rules: [], expected: null })).rejects.toMatchObject(
			{ code: "configuration_conflict" },
		);
		await expect(
			configuration.setEffortRules({
				scope: "global",
				rules: [{ selector: "anthropic/*", allowed: [] }],
				expected: rules,
			}),
		).rejects.toThrow();
		await configuration.setEffortRules({
			scope: "project",
			expected: [{ selector: "re:^anthropic/", allowed: ["off"] }],
		});
		expect(cfgEffortRules.get(settings)).toEqual(rules);
	});

	test("catalog projects native providers and facts without credential bytes", async () => {
		const result = await configuration.read();
		expect(result.models[0]).toMatchObject({ provider: "anthropic", id: "claude-sonnet-4-5", available: true });
		expect(result.providers.find(provider => provider.id === "anthropic")).toMatchObject({
			authenticated: true,
			mark: { icon: "provider:anthropic" },
		});
		expect(JSON.stringify(result)).not.toContain("fixture-key-never-returned");
	});

	test("catalog reports the native effective budget separately from model capability", async () => {
		cfgCompactionEnabled.override(settings, true);
		cfgCompactionThresholdTokens.override(settings, 50000);
		const model = session.model;
		if (!model) throw new Error("Missing session model");
		const result = await configuration.read();
		expect(result.models[0]?.effectiveContextWindow).toBe(50000);
		expect(result.models[0]?.contextWindow).toBe(model.contextWindow);
	});

	test("role storage can be changed through its owner without dropping either saved scope", async () => {
		await configuration.setRole({
			role: "reviewer",
			scope: "global",
			selector: "anthropic/claude-sonnet-4-5",
			expected: { selector: null, effort: null },
		});
		await configuration.setRole({
			role: "reviewer",
			scope: "project",
			selector: "re:^anthropic/",
			expected: { selector: null, effort: null },
		});
		await configuration.setRoleStorage({ value: "global", expected: "project" });
		expect(cfgModelRoleStorage.get(settings)).toBe("global");
		expect(settings.getGlobalModelRole("reviewer")).toBe("anthropic/claude-sonnet-4-5");
		expect(settings.getProjectModelRole("reviewer")).toBe("re:^anthropic/");
		await expect(configuration.setRoleStorage({ value: "project", expected: "project" })).rejects.toMatchObject({
			code: "configuration_conflict",
		});
	});

	test("login cancellation is connection-owned and disconnect aborts the remaining flow", async () => {
		const started = Promise.withResolvers<void>();
		const signals: AbortSignal[] = [];
		vi.spyOn(auth.oauth, "login").mockImplementation(async (_provider, ctrl) => {
			if (!ctrl.signal) throw new Error("Missing cancellation signal");
			signals.push(ctrl.signal);
			started.resolve();
			const pendingLogin = Promise.withResolvers<void>();
			ctrl.signal.addEventListener("abort", () => pendingLogin.reject(new Error("aborted")), { once: true });
			await pendingLogin.promise;
			return { type: "api_key" };
		});
		const pending = new RpcPendingExtensionRequests();
		const options = { session, output: () => {}, pending, input: async () => undefined };
		const first = new RpcModelsCommands(options);
		const second = new RpcModelsCommands({ ...options, pending: new RpcPendingExtensionRequests() });
		const login = first.handle({ type: "login", providerId: "anthropic", id: "login-fixture" });
		await started.promise;
		expect(await second.handle({ type: "cancel_login", loginId: "login-fixture" })).toMatchObject({ success: false });
		expect(signals[0]?.aborted).toBe(false);
		pending.rejectAll("connection closed");
		expect(await login).toMatchObject({ success: false, code: "login_cancelled" });
		expect(signals[0]?.aborted).toBe(true);
	});
});
