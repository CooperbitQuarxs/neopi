import { useEffect, useMemo, useState } from "react";
import type { ListModelsResponse, ModelSelectorFacts, ModelSelectorItem, ModelSelectorResult, NpiModelRolesResponse } from "@npi-deck/protocol";
import { useProviders } from "./providers";

export interface ModelTarget { sessionId?: string; cwd?: string }
export interface PickRole { value: string; name: string; resolves: string | null }
export interface PickProvider { id: string; label: string; hidden: boolean; models: readonly PickerModel[] }
export interface PickerModel extends ModelSelectorItem { available: boolean; role: boolean }
export interface PickerCatalog {
	roles: readonly PickRole[];
	providers: readonly PickProvider[];
	items: readonly PickerModel[];
	efforts: readonly string[];
	roleError: string | null;
}
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
	anthropic: "Anthropic", "openai-codex": "OpenAI Codex", openai: "OpenAI", xai: "xAI", zai: "Z.ai",
	cerebras: "Cerebras", github: "GitHub Models", google: "Google", mixture: "Mixtures", neoproxy: "NeoProxy",
};
export function providerLabel(id: string): string { return PROVIDER_LABELS[id] ?? id; }
const unknownFacts: ModelSelectorFacts = {
	intelligence: null, ttftMs: null, tokensPerSecond: null, contextWindow: null, effectiveContextWindow: null,
	inputCostPerMillion: null, outputCostPerMillion: null, performanceSource: null, serviceTier: null,
};
function params(target: ModelTarget): URLSearchParams {
	const query = new URLSearchParams();
	if (target.sessionId) query.set("sessionId", target.sessionId);
	if (target.cwd) query.set("cwd", target.cwd);
	return query;
}
async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, { signal });
	const body = await response.json();
	if (!response.ok) throw new Error(body.error ?? `Model request failed (${response.status}).`);
	return body as T;
}
export const models = {
	async catalog(target: ModelTarget = {}, signal?: AbortSignal): Promise<PickerCatalog> {
		let roleError: string | null = null;
		const [list, roleConfig] = await Promise.all([
			request<ListModelsResponse>(`/api/models?${params(target)}`, signal),
			request<NpiModelRolesResponse>(`/api/npi-config/model-roles?${params(target)}`, signal).catch((error: unknown) => {
				roleError = error instanceof Error ? error.message : String(error); return null;
			}),
		]);
		const chatRole = roleConfig?.roles.find(role => role.id === "default" && role.section === "chat");
		const chatPool = chatRole ? roleConfig?.pools?.[chatRole.pool] : undefined;
		const chatModels = chatPool ? new Set(chatPool.models) : null;
		const items: PickerModel[] = list.models.map(model => ({
			selector: `${model.provider}/${model.id}`, provider: model.provider, id: model.id, name: model.label || model.id,
			resolvedSelector: `${model.provider}/${model.id}`, facts: { ...unknownFacts, contextWindow: model.contextWindow ?? null },
			available: model.isAvailable && (!chatModels || chatModels.has(`${model.provider}/${model.id}`) || (model.isMixture === true && chatPool?.mixtures === true)), role: false,
		}));
		const roleItems: PickerModel[] = (roleConfig?.roles ?? []).filter(role => role.section === "chat" && !role.hidden).map(role => ({
			selector: `@${role.id}`, provider: role.resolved?.provider ?? "", id: role.id, name: role.name,
			description: role.effectiveValue ?? "Built-in model policy", resolvedSelector: role.resolved ? `${role.resolved.provider}/${role.resolved.modelId}` : null,
			facts: { ...unknownFacts }, available: !!role.resolved, role: true,
		}));
		const groups = new Map<string, PickerModel[]>();
		for (const item of items) { const group = groups.get(item.provider) ?? []; group.push(item); groups.set(item.provider, group); }
		return {
			items: [...roleItems, ...items], roles: roleItems.map(role => ({ value: role.selector, name: role.name, resolves: role.resolvedSelector })),
			providers: [...groups].map(([id, group]) => ({ id, label: providerLabel(id), hidden: false, models: group })),
			efforts: roleConfig?.thinkingLevels ?? [], roleError,
		};
	},
};

export function hiddenProviderIds(exposure: readonly { id: string; hidden: boolean }[]): ReadonlySet<string> {
	return new Set(exposure.filter(provider => provider.hidden).flatMap(provider => {
		if (provider.id === "codex" || provider.id === "openai-codex") return ["codex", "openai-codex"];
		if (provider.id === "zai" || provider.id === "zai-coding-plan") return ["zai", "zai-coding-plan"];
		return [provider.id];
	}));
}
export function visibleModels<T extends { provider: string }>(items: readonly T[], hidden: ReadonlySet<string>): T[] {
	return items.filter(item => !hidden.has(item.provider));
}
export function useHiddenProviders(): ReadonlySet<string> {
	const exposure = useProviders();
	return useMemo(() => hiddenProviderIds(exposure), [exposure]);
}
/** No permanent cache: opening a picker re-reads configuration and authentication. */
export function useCatalog(target: ModelTarget = {}, enabled = true) {
	const [snapshot, setSnapshot] = useState<{ key: string; catalog?: PickerCatalog; error: string | null }>();
	const key = JSON.stringify([target.sessionId, target.cwd]);
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		setSnapshot(undefined);
		void models.catalog(target, controller.signal).then(catalog => setSnapshot({ key, catalog, error: null }), error => {
			if (!controller.signal.aborted) setSnapshot({ key, error: error instanceof Error ? error.message : String(error) });
		});
		return () => controller.abort();
	}, [key, enabled]);
	const hidden = useHiddenProviders();
	const catalog = snapshot?.key === key ? snapshot.catalog : undefined;
	return {
		catalog: useMemo(() => catalog ? {
			...catalog, items: visibleModels(catalog.items, hidden),
			roles: catalog.roles.filter(role => !hidden.has(role.resolves?.split("/")[0] ?? "")),
			providers: catalog.providers.filter(provider => !hidden.has(provider.id)),
		} : undefined, [catalog, hidden]),
		error: snapshot?.key === key ? snapshot.error : null,
	};
}
export interface ModelQueryState { pending: boolean; result?: ModelSelectorResult; unavailable?: boolean; error?: string }
export function useModelQuery(target: ModelTarget, query: string): ModelQueryState {
	const key = JSON.stringify([target.sessionId, target.cwd, query]);
	const [snapshot, setSnapshot] = useState<{ key: string; result?: ModelSelectorResult; unavailable?: boolean; error?: string }>();
	useEffect(() => {
		const controller = new AbortController();
		const search = params(target); search.set("q", query);
		void fetch(`/api/models/selector?${search}`, { signal: controller.signal }).then(async response => {
			const result = await response.json();
			if (controller.signal.aborted) return;
			if (response.status === 501) setSnapshot({ key, unavailable: true, error: result.error });
			else if (!response.ok || result.error) setSnapshot({ key, error: result.error ?? "Native model search failed." });
			else setSnapshot({ key, result });
		}).catch(error => { if (!controller.signal.aborted) setSnapshot({ key, error: String(error) }); });
		return () => controller.abort();
	}, [key]);
	return snapshot?.key === key ? { result: snapshot.result, unavailable: snapshot.unavailable, error: snapshot.error, pending: false } : { pending: true };
}
/** Only native effort suffixes are separated; provider IDs and model IDs stay intact. */
export function splitPick(value: string, efforts: readonly string[]): { selector: string; effort: string } {
	const colon = value.lastIndexOf(":");
	return colon >= 0 && efforts.includes(value.slice(colon + 1))
		? { selector: value.slice(0, colon), effort: value.slice(colon + 1) } : { selector: value, effort: "" };
}
export function shortPick(value: string): string { return value.slice(value.lastIndexOf("/") + 1); }
