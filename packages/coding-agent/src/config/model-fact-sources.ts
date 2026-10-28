import type { Api, Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { createModelManager, type ModelRefreshStrategy } from "@oh-my-pi/pi-catalog/model-manager";
import {
	fetchWellKnownModels,
	mapModelsDevToModels,
	MODELS_DEV_PROVIDER_DESCRIPTORS,
	openrouterModelManagerOptions,
} from "@oh-my-pi/pi-catalog/provider-models/openai-compat";
import { isRecord, logger, type FetchImpl } from "@oh-my-pi/pi-utils";
import type { ModelFactSourceSnapshot } from "./model-facts";
import { RUNTIME_DYNAMIC_MODEL_FETCH_TIMEOUT_MS, withModelDiscoveryTimeout } from "./model-provider-discovery";

export interface ModelFactSourceHost {
	fetch: FetchImpl;
	cacheDbPath?: string;
	/** Uses the registry's existing provider discovery and credentials, including extension providers. */
	providerModels(provider: string, strategy: ModelRefreshStrategy): Promise<readonly Model<Api>[]>;
}

/** Source names select adapters, never model-specific policy. Failed sources contribute no facts. */
export async function loadModelFactSources(
	sources: readonly string[],
	strategy: ModelRefreshStrategy,
	host: ModelFactSourceHost,
	previous: readonly ModelFactSourceSnapshot[] = [],
): Promise<ModelFactSourceSnapshot[]> {
	return Promise.all(
		sources.map(async source => {
			try {
				let models: readonly Model<Api>[];
				if (source === "stencil") {
					if (strategy === "offline")
						return previous.find(snapshot => snapshot.source === source) ?? { source, models: [] };
					const payload = await fetchWellKnownModels(host.fetch, undefined, { allowStale: false });
					models = isRecord(payload)
						? mapModelsDevToModels(payload, MODELS_DEV_PROVIDER_DESCRIPTORS).map(spec => buildModel(spec))
						: [];
				} else if (source === "openrouter") {
					// This public catalog does not need credentials. Reuse the provider mapper and cache.
					const manager = createModelManager({
						...openrouterModelManagerOptions({ fetch: host.fetch }),
						cacheDbPath: host.cacheDbPath,
					});
					const result = await withModelDiscoveryTimeout(RUNTIME_DYNAMIC_MODEL_FETCH_TIMEOUT_MS, () =>
						manager.refresh(strategy),
					);
					models =
						result.source === "bundled" || (strategy !== "offline" && result.source === "cache" && result.stale)
							? []
							: result.models;
				} else {
					models = await host.providerModels(source, strategy);
				}
				return { source, models };
			} catch (error) {
				logger.debug("Model fact source unavailable", {
					source,
					error: error instanceof Error ? error.message : String(error),
				});
				return { source, models: [] };
			}
		}),
	);
}
