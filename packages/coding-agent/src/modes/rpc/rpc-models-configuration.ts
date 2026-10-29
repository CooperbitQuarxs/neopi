import { isDeepStrictEqual } from "node:util";
import { THINKING_CHOICES } from "@oh-my-pi/pi-catalog/effort";
import { providerEntry } from "@oh-my-pi/pi-catalog/compat/providers";
import { getSupportedThinkingLevels } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelKind } from "@oh-my-pi/pi-catalog/types";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { providerMark } from "@oh-my-pi/pi-tui/overlays/model-browser";
import {
	cfgEffortPolicyMode,
	cfgEffortRules,
	cfgFallbackEffortSelections,
	matchEffortRule,
	type EffortRule,
	type EffortSelection,
} from "../../config/effort-policy";
import { cfgDisabledProviders, cfgModelRoleStorage } from "../../config/model-settings";
import {
	deleteCustomRole,
	getKnownRoleIds,
	getRoleInfo,
	MODEL_ROLE_IDS,
	setRoleDescription,
} from "../../config/model-roles";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import type { AgentSession } from "../../session/agent-session";
import { cfgRetryFallbackChains } from "../../session/settings";
import { resolveEffectiveContextWindow } from "../../session/model-compaction-threshold";
import { RpcRoles, scopedRoleLookup } from "./rpc-roles";
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

export interface RpcModelRoleFallbacks {
	chain: string[];
	efforts: Record<string, EffortSelection>;
}

export interface RpcSetModelRoleFallbacks {
	role: string;
	/** Native fallback editing currently writes the global settings layer. */
	scope: "global" | "project";
	chain: string[];
	efforts: Record<string, EffortSelection>;
	expected: RpcModelRoleFallbacks;
}

export interface RpcSetModelRoleDescription {
	role: string;
	/** Native role descriptions are global role metadata. */
	scope: "global" | "project";
	description: string;
	expected: string | null;
}

export interface RpcDeleteModelRole {
	role: string;
	scope: "global" | "project";
	expected: RpcRoleConfigurationValue;
}

export interface RpcSetEffortRules {
	scope: "global" | "project";
	rules?: EffortRule[];
	expected: EffortRule[] | null;
}

export class RpcModelsConfigurationError extends Error {
	constructor(
		readonly code:
			| "invalid_value"
			| "configuration_conflict"
			| "session_busy"
			| "unknown_role"
			| "builtin_role"
			| "scope_mismatch",
		message: string,
	) {
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
			? (effort.rules as EffortRule[])
			: null;
	}

	#roleValue(role: string, scope: "global" | "project"): RpcRoleConfigurationValue {
		const settings = this.session.settings;
		return {
			selector:
				(scope === "global" ? settings.getGlobalModelRole(role) : settings.getProjectModelRole(role)) ?? null,
			effort:
				(scope === "global"
					? settings.getGlobalRoleEffortSelection(role)
					: settings.getProjectRoleEffortSelection(role)) ?? null,
		};
	}

	#fallbacks(role: string, global = false, globalSettings?: Record<string, unknown>): RpcModelRoleFallbacks {
		const settings = this.session.settings;
		const chains = global ? (globalSettings ?? settings.getGlobalSettings()).retry : undefined;
		return {
			chain:
				(global
					? (chains as { fallbackChains?: Record<string, string[]> } | undefined)?.fallbackChains?.[role]
					: cfgRetryFallbackChains.get(settings)[role]) ?? [],
			efforts:
				(global
					? settings.getGlobalFallbackEffortSelections(role)
					: cfgFallbackEffortSelections.get(settings)[role]) ?? {},
		};
	}

	#requireRole(role: string): void {
		if (typeof role !== "string" || !getKnownRoleIds(this.session.settings).includes(role))
			throw new RpcModelsConfigurationError("unknown_role", `Unknown model role: ${String(role)}`);
	}

	#requireGlobal(scope: string): void {
		if (scope !== "global")
			throw new RpcModelsConfigurationError("scope_mismatch", "This native role metadata is stored globally");
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
		const roles = new RpcRoles(this.session);
		const globalSettings = settings.getGlobalSettings();
		const ids = new Set([
			...all.map(model => model.provider),
			...modelRegistry.getDiscoverableProviders(),
			...oauth.map(provider => provider.storeCredentialsAs ?? provider.id),
		]);
		return {
			providers: [...ids].sort().map(id => ({
				id,
				name: oauth.find(provider => provider.id === id)?.name ?? id,
				mark: providerMark(id),
				authenticated: modelRegistry.authStorage.keys.source(id) !== undefined,
				authSource: modelRegistry.authStorage.keys.describe(id, this.session.sessionId) ?? null,
				disabled: disabled.has(id),
				acceptsKeys: modelRegistry.hasProvider(id),
				available:
					!disabled.has(id) && all.some(model => model.provider === id && available.has(`${id}/${model.id}`)),
				loginProviders: oauth
					.filter(provider => (provider.storeCredentialsAs ?? provider.id) === id)
					.map(provider => ({
						id: provider.id,
						name: provider.name,
						available: provider.available,
						loginKind: provider.loginKind,
						deviceCode: provider.deviceCode,
						...(provider.storeCredentialsAs ? { storeCredentialsAs: provider.storeCredentialsAs } : {}),
					})),
				envVars: providerEntry(id)?.envVars ?? [],
				discovery: modelRegistry.getProviderDiscoveryState(id) ?? null,
			})),
			models: all.map(model => {
				const supportedThinkingLevels = getSupportedThinkingLevels(model);
				const rule =
					cfgEffortPolicyMode.get(settings) === "replacement" ? matchEffortRule(settings, model) : undefined;
				return {
					provider: model.provider,
					id: model.id,
					name: model.name,
					...(model.description !== undefined ? { description: model.description } : {}),
					kind: modelKind(model),
					available: !disabled.has(model.provider) && available.has(`${model.provider}/${model.id}`),
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					reasoning: model.reasoning,
					effectiveContextWindow: resolveEffectiveContextWindow(this.session, model),
					cost: model.cost,
					supportsFastMode: serializeRpcModel(model).supportsFastMode,
					supportedThinkingLevels,
					permittedEfforts: supportedThinkingLevels.filter(level => !rule || rule.allowed.includes(level)),
				};
			}),
			roles: roles.list().roles.map(role => {
				const info = getRoleInfo(role.id, settings);
				return {
					id: role.id,
					name: role.name,
					alias: role.alias,
					hidden: role.hidden,
					source: role.source,
					section: role.section,
					patterns: role.patterns,
					fallbacks: this.#fallbacks(role.id),
					fallbacksGlobal: this.#fallbacks(role.id, true, globalSettings),
					...("description" in info && typeof info.description === "string"
						? { description: info.description }
						: {}),
					configured: role.configured ?? null,
					resolved: role.resolved ?? null,
					scopedResolutions: {
						global: roles.resolveScope(role.id, "global"),
						project: roles.resolveScope(role.id, "project"),
					},
					provenance: settings.getModelRoleProvenance(role.id),
					effort: settings.getRoleEffortSelection(role.id) ?? null,
					global: this.#roleValue(role.id, "global"),
					project: this.#roleValue(role.id, "project"),
				};
			}),
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
		if (input.scope !== "global" && input.scope !== "project")
			throw new RpcModelsConfigurationError("invalid_value", "Role scope must be global or project");
		if (typeof input.role !== "string" || !input.role.trim())
			throw new RpcModelsConfigurationError("invalid_value", "A role name is required");
		if (input.selector !== undefined && (typeof input.selector !== "string" || !input.selector.trim()))
			throw new RpcModelsConfigurationError("invalid_value", "A nonempty single model selector is required");
		await settings.reloadFromDisk();
		// `scope` is the caller's explicit write target, not the model hub's default storage preference.
		if (!isDeepStrictEqual(input.expected, this.#roleValue(input.role, input.scope)))
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"This scoped role changed in another client. Refresh before saving.",
			);
		settings.validateRoleModelAndEffort(input.role, input.selector, input.effort, input.scope);
		if (input.selector !== undefined) {
			const candidates = modelRegistry.getAll("all").filter(getRoleInfo(input.role, settings).accepts);
			const result = resolveModelRoleValue(input.selector, candidates, {
				settings,
				roleLookup: scopedRoleLookup(settings, input.scope),
				matchPreferences: getModelMatchPreferences(settings),
			});
			if (!result.model)
				throw new RpcModelsConfigurationError(
					"invalid_value",
					"Selector does not resolve to a compatible native model",
				);
		}
		if (input.role === "default" && (this.session.isStreaming || this.session.isCompacting))
			throw new RpcModelsConfigurationError(
				"session_busy",
				"Cannot change the default role while streaming or compacting",
			);
		const receipt = await settings.persistWithReceipt(() =>
			settings.setRoleModelAndEffort(input.role, input.selector, input.effort, input.scope),
		);
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Another native mutation superseded this scoped role. Refresh before saving.",
			);
	}

	async setRoleFallbacks(input: RpcSetModelRoleFallbacks): Promise<void> {
		this.#requireGlobal(input.scope);
		const { settings } = this.session;
		await settings.reloadFromDisk();
		this.#requireRole(input.role);
		if (!isDeepStrictEqual(input.expected, this.#fallbacks(input.role, true)))
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Role fallbacks changed. Refresh before saving.",
			);
		if (!Array.isArray(input.chain) || input.chain.some(selector => typeof selector !== "string" || !selector.trim()))
			throw new RpcModelsConfigurationError("invalid_value", "Fallbacks must be nonempty model selectors");
		if (
			!input.efforts ||
			typeof input.efforts !== "object" ||
			Array.isArray(input.efforts) ||
			Object.keys(input.efforts).some(selector => !input.chain.includes(selector))
		)
			throw new RpcModelsConfigurationError("invalid_value", "Fallback efforts must belong to the fallback chain");
		const receipt = await settings.persistWithReceipt(() =>
			settings.setFallbackChainAndEfforts(input.role, input.chain, input.efforts),
		);
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Role fallbacks changed. Refresh before saving.",
			);
	}

	async setRoleDescription(input: RpcSetModelRoleDescription): Promise<void> {
		this.#requireGlobal(input.scope);
		const { settings } = this.session;
		await settings.reloadFromDisk();
		this.#requireRole(input.role);
		if (typeof input.description !== "string")
			throw new RpcModelsConfigurationError("invalid_value", "Role description must be a string");
		const description = getRoleInfo(input.role, settings).description ?? null;
		if (input.expected !== description)
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Role description changed. Refresh before saving.",
			);
		const receipt = await settings.persistWithReceipt(() =>
			setRoleDescription(input.role, input.description, settings),
		);
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Role description changed. Refresh before saving.",
			);
	}

	async deleteRole(input: RpcDeleteModelRole): Promise<void> {
		if (input.scope !== "global" && input.scope !== "project")
			throw new RpcModelsConfigurationError("scope_mismatch", "Role scope must be global or project");
		const { settings } = this.session;
		await settings.reloadFromDisk();
		this.#requireRole(input.role);
		if (MODEL_ROLE_IDS.some(role => role === input.role))
			throw new RpcModelsConfigurationError("builtin_role", "Built-in model roles cannot be deleted");
		const layer = input.scope === "global" ? settings.getGlobalSettings() : settings.getProjectSettings();
		const tags = layer.modelTags as Record<string, unknown> | undefined;
		const scoped = this.#roleValue(input.role, input.scope);
		if (
			scoped.selector === null &&
			scoped.effort === null &&
			!tags?.[input.role] &&
			!(Array.isArray(layer.cycleOrder) && layer.cycleOrder.includes(input.role))
		)
			throw new RpcModelsConfigurationError("scope_mismatch", "This role is not defined in the selected scope");
		if (!isDeepStrictEqual(input.expected, scoped))
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"This scoped role changed. Refresh before deleting.",
			);
		const receipt = await settings.persistWithReceipt(() => deleteCustomRole(input.role, input.scope, settings));
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"This scoped role changed. Refresh before deleting.",
			);
	}

	async setRoleStorage(input: { value: "global" | "project"; expected: "global" | "project" }): Promise<void> {
		const { settings } = this.session;
		await settings.reloadFromDisk();
		if (cfgModelRoleStorage.get(settings) !== input.expected)
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Native role storage changed in another client. Refresh before saving.",
			);
		const receipt = await settings.persistWithReceipt(() => cfgModelRoleStorage.set(settings, input.value));
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Another native mutation superseded this role-storage preference. Refresh before saving.",
			);
	}

	async setEffortRules(input: RpcSetEffortRules): Promise<void> {
		const { settings } = this.session;
		await settings.reloadFromDisk();
		if (input.scope !== "global" && input.scope !== "project")
			throw new RpcModelsConfigurationError("invalid_value", "Effort rule scope must be global or project");
		if (!isDeepStrictEqual(input.expected, this.#effortRules(input.scope)))
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Effort rules changed in another client. Refresh before saving.",
			);
		const receipt = await settings.persistWithReceipt(() => {
			if (input.scope === "project") settings.writeProjectValue(cfgEffortRules, input.rules);
			else if (input.rules === undefined) cfgEffortRules.unset(settings);
			else cfgEffortRules.set(settings, input.rules);
		});
		if (receipt.status === "conflict")
			throw new RpcModelsConfigurationError(
				"configuration_conflict",
				"Another native mutation superseded these scoped effort rules. Refresh before saving.",
			);
	}
}
