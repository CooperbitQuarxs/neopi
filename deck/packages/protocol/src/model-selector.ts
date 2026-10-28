/** Native /switch result. Selector IDs are opaque, including @role policies. */
export interface ModelSelectorFacts {
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
export interface ModelSelectorItem {
	selector: string;
	provider: string;
	id: string;
	name: string;
	description?: string;
	resolvedSelector: string | null;
	facts: ModelSelectorFacts;
}
export interface ModelSelectorResult {
	items: ModelSelectorItem[];
	roles: ModelSelectorItem[];
	error: string | null;
}
