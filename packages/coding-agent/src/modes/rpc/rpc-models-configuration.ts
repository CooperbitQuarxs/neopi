import { isDeepStrictEqual } from "node:util";
import { THINKING_CHOICES } from "@oh-my-pi/pi-catalog/effort";
import { providerEntry } from "@oh-my-pi/pi-catalog/compat/providers";
import { getSupportedThinkingLevels } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelKind } from "@oh-my-pi/pi-catalog/types";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { providerMark } from "@oh-my-pi/pi-tui/overlays/model-browser";
import {
	cfgEffortPolicyMode, cfgEffortRules, matchEffortRule,
	type EffortRule, type EffortSelection,
} from "../../config/effort-policy";
import { cfgDisabledProviders, cfgModelRoleStorage } from "../../config/model-settings";
import { getRoleInfo } from "../../config/model-roles";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import type { AgentSession } from "../../session/agent-session";
import { RpcRoles } from "./rpc-roles";
import { serializeRpcModel } from "./rpc-model";

export interface RpcRoleConfigurationValue {
	selector: string | null;
	effort: EffortSelection | null;
}

export interface RpcSetModelRoleConfiguration {
	role: string;
	scope: "global" | "project";
	selector?: string;
	effort?: EffortSelection;
	expected: RpcRoleConfigurationValue;
}

export interface RpcSetEffortRules {
	scope: "global" | "project";
	rules?: EffortRule[];
	expected: EffortRule[] | null;
}

export class RpcModelsConfigurationError extends Error {
	constructor(readonly code: "invalid_value" | "configuration_conflict" | "session_busy", message: string) {
		super(message);
	}
}

/** Use the same scoped transaction and resolver as the native model hub. No credentials leave this projection. */
export class RpcModelsConfiguration {
	constructor(readonly session: AgentSession) {}

	#effortRules(scope: "global" | "project"): EffortRule[] | null {
		const settings = this.session.settings;
		const layer = scope === "global" ? settings.getGlobalSettings() : settings.getProjectSettings();
		const effort = layer.effort;
		return effort && typeof effort === "object" && "rules" in effort && Array.isArray(effort.rules)
			? effort.rules as EffortRule[] : null;
	}

	#roleValue(role: string, scope: "global" | "project"): RpcRoleConfigurationValue {
		const settings = this.session.settings;
		return {
			selector: (scope === "global" ? settings.getGlobalModelRole(role) : settings.getProjectModelRole(role)) ?? null,
			effort: (scope === "global" ? settings.getGlobalRoleEffortSelection(role) : settings.getProjectRoleEffortSelection(role)) ?? null,
		};
	}

	async read() {
		const { settings, modelRegistry } = this.session;
		await settings.reloadFromDisk();
		await modelRegistry.authStorage.credentials.reload();
		await modelRegistry.awaitBackgroundRefresh();
		const disabled = new Set(cfgDisabledProviders.get(settings));
		const all = modelRegistry.getAll("all");
		const available = new Set(modelRegistry.getAvailable("all").map(model => `${model.provider}/${model.id}`));
		const oauth = getOAuthProviders();
		const ids = new Set([...all.map(model => model.provider), ...modelRegistry.getDiscoverableProviders(), ...oauth.map(provider => provider.storeCredentialsAs ?? provider.id)]);
		return {
			providers: [...ids].sort().map(id => ({
				id,
				name: oauth.find(provider => provider.id === id)?.name ?? id,
				mark: providerMark(id),
				authenticated: modelRegistry.authStorage.keys.source(id) !== undefined,
				authSource: modelRegistry.authStorage.keys.describe(id, this.session.sessionId) ?? null,
				disabled: disabled.has(id),
				available: all.some(model => model.provider === id && available.has(`${id}/${model.id}`)),
				loginProviders: oauth.filter(provider => (provider.storeCredentialsAs ?? provider.id) === id).map(provider => ({ id: provider.id, name: provider.name, available: provider.available })),
				envVars: providerEntry(id)?.envVars ?? [],
				discovery: modelRegistry.getProviderDiscoveryState(id) ?? null,
			})),
			models: all.map(model => {
				const supportedThinkingLevels = getSupportedThinkingLevels(model);
				const rule = cfgEffortPolicyMode.get(settings) === "replacement" ? matchEffortRule(settings, model) : undefined;
				return {
					provider: model.provider, id: model.id, name: model.name, kind: modelKind(model),
					available: !disabled.has(model.provider) && available.has(`${model.provider}/${model.id}`),
					contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning,
					cost: model.cost, supportsFastMode: serializeRpcModel(model).supportsFastMode,
					supportedThinkingLevels,
					permittedEfforts: supportedThinkingLevels.filter(level => !rule || rule.allowed.includes(level)),
				};
			}),
			roles: new RpcRoles(this.session).list().roles.map(role => ({
				id: role.id, name: role.name, alias: role.alias, hidden: role.hidden,
				configured: role.configured ?? null, resolved: role.resolved ?? null,
				provenance: settings.getModelRoleProvenance(role.id),
				effort: settings.getRoleEffortSelection(role.id) ?? null,
				global: this.#roleValue(role.id, "global"), project: this.#roleValue(role.id, "project"),
			})),
			roleStorage: cfgModelRoleStorage.get(settings),
			effortMode: cfgEffortPolicyMode.get(settings),
			effortRules: cfgEffortRules.get(settings),
			effortRulesProvenance: cfgEffortRules.provenance(settings),
			effortRuleScopes: { global: this.#effortRules("global"), project: this.#effortRules("project") },
			effortChoices: [...THINKING_CHOICES],
		};
	}

	async setRole(input: RpcSetModelRoleConfiguration): Promise<void> {
		const { settings, modelRegistry } = this.session;
		if (input.scope !== "global" && input.scope !== "project") throw new RpcModelsConfigurationError("invalid_value", "Role scope must be global or project");
		if (typeof input.role !== "string" || !input.role.trim()) throw new RpcModelsConfigurationError("invalid_value", "A role name is required");
		if (input.selector !== undefined && (typeof input.selector !== "string" || !input.selector.trim())) throw new RpcModelsConfigurationError("invalid_value", "A nonempty single model selector is required");
		await settings.reloadFromDisk();
		if (input.scope === "project" && cfgModelRoleStorage.get(settings) !== "project") throw new RpcModelsConfigurationError("invalid_value", "Native model-role storage is global; project assignments are disabled");
		if (!isDeepStrictEqual(input.expected, this.#roleValue(input.role, input.scope))) throw new RpcModelsConfigurationError("configuration_conflict", "This scoped role changed in another client. Refresh before saving.");
		settings.validateRoleModelAndEffort(input.role, input.selector, input.effort, input.scope);
		if (input.selector !== undefined) {
			const candidates = modelRegistry.getAll("all").filter(getRoleInfo(input.role, settings).accepts);
			const result = resolveModelRoleValue(input.selector, candidates, { settings, matchPreferences: getModelMatchPreferences(settings) });
			if (!result.model) throw new RpcModelsConfigurationError("invalid_value", "Selector does not resolve to a compatible native model");
		}
		if (input.role === "default" && (this.session.isStreaming || this.session.isCompacting)) throw new RpcModelsConfigurationError("session_busy", "Cannot change the default role while streaming or compacting");
		settings.setRoleModelAndEffort(input.role, input.selector, input.effort, input.scope);
		await settings.flush();
	}

	async setEffortRules(input: RpcSetEffortRules): Promise<void> {
		const { settings } = this.session;
		await settings.reloadFromDisk();
		if (input.scope !== "global" && input.scope !== "project") throw new RpcModelsConfigurationError("invalid_value", "Effort rule scope must be global or project");
		if (!isDeepStrictEqual(input.expected, this.#effortRules(input.scope))) throw new RpcModelsConfigurationError("configuration_conflict", "Effort rules changed in another client. Refresh before saving.");
		if (input.scope === "project") settings.writeProjectValue(cfgEffortRules, input.rules);
		else if (input.rules === undefined) cfgEffortRules.unset(settings);
		else cfgEffortRules.set(settings, input.rules);
		await settings.flush();
	}
}
