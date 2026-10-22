import type { Model } from "@oh-my-pi/pi-ai";
import { modelKind } from "@oh-my-pi/pi-catalog/types";
import {
	buildSessionModelScope,
	ModelBrowser,
	type ModelBrowserItem,
	type ModelBrowserRegistry,
	type ModelBrowserSource,
} from "@oh-my-pi/pi-tui/overlays/model-browser";
import type { AgentSession } from "../../session/agent-session";
import { resolveEffectiveContextWindow } from "../../session/model-compaction-threshold";
import { createModelBrowserSource } from "../model-browser-source";

export interface RpcModelSelectorFacts {
	intelligence: number | null;
	ttftMs: number | null;
	tokensPerSecond: number | null;
	contextWindow: number | null;
	effectiveContextWindow: number | null;
	inputCostPerMillion: number | null;
	outputCostPerMillion: number | null;
	performanceSource: "measured" | "catalog" | null;
	serviceTier: string | null;
}

export interface RpcModelSelectorItem {
	selector: string;
	provider: string;
	id: string;
	name: string;
	description?: string;
	resolvedSelector: string | null;
	facts: RpcModelSelectorFacts;
}

export interface RpcModelSelectorResult {
	items: RpcModelSelectorItem[];
	roles: RpcModelSelectorItem[];
	error: string | null;
}

function finite(value: number | null | undefined, positive = false): number | null {
	return value != null && Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : null;
}

/** Query the actual native picker without mounting UI, selecting a model, or writing usage. */
export function queryModelSelector(
	source: ModelBrowserSource,
	registry: ModelBrowserRegistry,
	scopedModels: ReadonlyArray<Model>,
	query: string,
): RpcModelSelectorResult {
	const scope = buildSessionModelScope(source, registry, scopedModels);
	const browser = new ModelBrowser(source);
	browser.setRoles(scope.roles);
	browser.setMruOrder(scope.mruOrder);
	browser.setPerfStats(source.modelPerf);
	const matches = (items: ModelBrowserItem[]) => {
		browser.setItems(items);
		browser.setQuery(query);
		return browser.queryMatches ?? items;
	};
	const facts = (item: ModelBrowserItem): RpcModelSelectorFacts => {
		const { model } = item;
		const measured = browser.measuredPerformance(item);
		const measuredSpeed = finite(measured?.perf.tps);
		const catalogSpeed = finite(model.tps, true);
		return {
			intelligence: finite(model.int),
			ttftMs: finite(measured?.perf.ttftMs),
			tokensPerSecond: measuredSpeed ?? catalogSpeed,
			contextWindow: finite(model.contextWindow, true),
			effectiveContextWindow: finite(source.effectiveContextWindowFor?.(model), true),
			inputCostPerMillion: finite(model.cost.input),
			outputCostPerMillion: finite(model.cost.output),
			performanceSource: measuredSpeed !== null ? "measured" : catalogSpeed !== null ? "catalog" : null,
			serviceTier: measured?.tier ?? null,
		};
	};
	const project = (item: ModelBrowserItem): RpcModelSelectorItem => ({
		selector: item.selector,
		provider: item.model.provider,
		id: item.id,
		name: item.model.name,
		...(item.model.description !== undefined ? { description: item.model.description } : {}),
		resolvedSelector: `${item.model.provider}/${item.model.id}`,
		facts: facts({ ...item, selector: `${item.model.provider}/${item.model.id}` }),
	});
	const items = matches(scope.items).map(project);
	const roleItems: ModelBrowserItem[] = [];
	for (const role of source.knownRoleIds) {
		const info = source.getRoleInfo(role);
		const assignment = scope.roles[role];
		if (info.hidden || !assignment || modelKind(assignment.model) !== "chat") continue;
		roleItems.push({ provider: "", id: `@${role}`, selector: `@${role}`, model: assignment.model });
	}
	// Native role mode keeps its configured order instead of concrete-model affinity.
	browser.setPreserveQueryOrder(true);
	const roles = matches(roleItems).map(item => {
		const role = item.id.slice(1);
		const info = source.getRoleInfo(role);
		return {
			...project(item),
			id: role,
			name: info.name,
			...(info.description !== undefined ? { description: info.description } : {}),
		};
	});
	return { items, roles, error: scope.error ?? null };
}

export async function getRpcModelSelector(session: AgentSession, query: string): Promise<RpcModelSelectorResult> {
	await session.modelRegistry.awaitBackgroundRefresh();
	const source = createModelBrowserSource(session.settings, model => session.effectiveServiceTier(model));
	source.effectiveContextWindowFor = model => resolveEffectiveContextWindow(session, model);
	return queryModelSelector(source, session.modelRegistry, session.scopedModels.map(entry => entry.model), query);
}
