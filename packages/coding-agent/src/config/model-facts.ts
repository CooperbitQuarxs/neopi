import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import { THINKING_EFFORTS, type Effort } from "@oh-my-pi/pi-catalog/effort";
import { getReferenceCandidateIds } from "@oh-my-pi/pi-catalog/identity";
import { toModelSpec } from "@oh-my-pi/pi-catalog/provider-models/bundled-references";
import type { Api, Model, ModelCost, ThinkingConfig } from "@oh-my-pi/pi-catalog/types";
import { isRecord } from "@oh-my-pi/pi-utils";
import { register, type ScopeLike } from "./registry";

export interface ModelFactValues {
	cost: ModelCost;
	contextWindow: number | null;
	maxTokens: number | null;
	input: Model<Api>["input"];
	reasoning: boolean;
	efforts: readonly Effort[];
}

export type ModelFactField = keyof ModelFactValues;
export const MODEL_FACT_FIELDS: readonly ModelFactField[] = [
	"cost",
	"contextWindow",
	"maxTokens",
	"input",
	"reasoning",
	"efforts",
];

export interface ModelFactReference {
	from: string;
}

export type ModelFactOverride = {
	[Field in ModelFactField]?: ModelFactValues[Field] | ModelFactReference;
};
export type ModelFactOverrides = Record<string, ModelFactOverride>;

export interface ModelFactConfig {
	enabled: boolean;
	sources: readonly string[];
	overrides: ModelFactOverrides;
}

export interface ModelFactSourceSnapshot {
	source: string;
	models: readonly Model<Api>[];
}

export interface ModelFactProvenance {
	kind: "provider" | "source" | "override" | "reference";
	provider?: string;
	model?: string;
	source?: string;
}

export interface ModelFactResolution {
	model: Model<Api>;
	provenance: Partial<Record<ModelFactField, ModelFactProvenance>>;
	issues: readonly string[];
}

export interface ModelFactResolveOptions {
	/** Fields known to contain discovery placeholders rather than reported facts. */
	missingFields?: readonly ModelFactField[];
	/** Exact target provider/model -> exact source provider/model, without fuzzy matching. */
	matches?: Readonly<Record<string, string>>;
}

export interface ModelFactApplyOptions {
	referenceModels?: readonly Model<Api>[];
	/** Supplies target-provider transport for an override-only model. */
	createModel?: (provider: string, id: string) => Model<Api> | undefined;
	missingFields?: ReadonlyMap<string, readonly ModelFactField[]>;
	matches?: Readonly<Record<string, string>>;
}

export const DEFAULT_MODEL_FACT_CONFIG: ModelFactConfig = {
	enabled: false,
	sources: ["openrouter", "stencil"],
	overrides: {},
};

function exactModelKey(value: unknown): value is string {
	if (typeof value !== "string" || value.trim() !== value) return false;
	const slash = value.indexOf("/");
	return slash > 0 && slash < value.length - 1 && !/\s/.test(value);
}

export function isModelFactReference(value: unknown): value is ModelFactReference {
	return isRecord(value) && typeof value.from === "string";
}

function invalid(message: string): never {
	throw new Error(`Invalid model facts: ${message}`);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) invalid(`${path}.${key} is not supported`);
	}
}

function finiteNonnegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateRates(
	value: unknown,
	path: string,
	extra: readonly string[] = [],
): asserts value is Record<string, unknown> {
	if (!isRecord(value)) invalid(`${path} must be a rate card`);
	assertKeys(value, ["input", "output", "cacheRead", "cacheWrite", ...extra], path);
	for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
		if (!finiteNonnegative(value[field])) invalid(`${path}.${field} must be a finite nonnegative number`);
	}
}

function validateLongContext(value: unknown, path: string): void {
	validateRates(value, path, ["inputThreshold", "inputThresholdInclusive"]);
	if (!Number.isSafeInteger(value.inputThreshold) || Number(value.inputThreshold) <= 0) {
		invalid(`${path}.inputThreshold must be a positive integer`);
	}
	if (value.inputThresholdInclusive !== undefined && typeof value.inputThresholdInclusive !== "boolean") {
		invalid(`${path}.inputThresholdInclusive must be boolean`);
	}
}

function validateCost(value: unknown, path: string): void {
	validateRates(value, path, ["longContext", "timeBased"]);
	if (value.longContext !== undefined) validateLongContext(value.longContext, `${path}.longContext`);
	if (value.timeBased === undefined) return;
	const time = value.timeBased;
	if (!isRecord(time)) invalid(`${path}.timeBased must be an object`);
	assertKeys(time, ["offPeakMultiplier", "peakWindows", "effectiveRates"], `${path}.timeBased`);
	if (!finiteNonnegative(time.offPeakMultiplier)) invalid(`${path}.timeBased.offPeakMultiplier must be nonnegative`);
	if (!Array.isArray(time.peakWindows)) invalid(`${path}.timeBased.peakWindows must be an array`);
	for (const window of time.peakWindows) {
		if (!isRecord(window)) invalid(`${path}.timeBased.peakWindows entries must be objects`);
		assertKeys(window, ["weekdays", "startMinute", "endMinute"], `${path}.timeBased.peakWindows`);
		if (
			!Array.isArray(window.weekdays) ||
			window.weekdays.length === 0 ||
			window.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
		) {
			invalid(`${path}.timeBased.peakWindows weekdays must be integers from 0 to 6`);
		}
		if (
			!Number.isInteger(window.startMinute) ||
			!Number.isInteger(window.endMinute) ||
			Number(window.startMinute) < 0 ||
			Number(window.endMinute) > 1440 ||
			Number(window.startMinute) >= Number(window.endMinute)
		) {
			invalid(`${path}.timeBased.peakWindows must have increasing minutes from 0 to 1440`);
		}
	}
	if (time.effectiveRates !== undefined) {
		if (!Array.isArray(time.effectiveRates)) invalid(`${path}.timeBased.effectiveRates must be an array`);
		for (const rate of time.effectiveRates) {
			validateRates(rate, `${path}.timeBased.effectiveRates`, ["effectiveFrom", "longContext"]);
			if (!finiteNonnegative(rate.effectiveFrom)) invalid(`${path}.timeBased.effectiveFrom must be nonnegative`);
			if (rate.longContext !== undefined) validateLongContext(rate.longContext, `${path}.timeBased.longContext`);
		}
	}
}

export function validateModelFactSources(value: unknown): asserts value is readonly string[] {
	if (
		!Array.isArray(value) ||
		value.some(source => typeof source !== "string" || !source || source.trim() !== source)
	) {
		invalid("sources must be an array of nonempty source names");
	}
	if (new Set(value).size !== value.length) invalid("sources must not contain duplicates");
}

export function validateModelFactOverrides(value: unknown): asserts value is ModelFactOverrides {
	if (!isRecord(value)) invalid("overrides must be a provider/model record");
	for (const [key, override] of Object.entries(value)) {
		if (!exactModelKey(key)) invalid(`override key ${key} must be provider/model`);
		if (!isRecord(override)) invalid(`${key} must be a field override object`);
		assertKeys(override, MODEL_FACT_FIELDS, key);
		for (const [field, literal] of Object.entries(override)) {
			if (isRecord(literal) && "from" in literal) {
				assertKeys(literal, ["from"], `${key}.${field}`);
				if (!exactModelKey(literal.from)) invalid(`${key}.${field}.from must be provider/model`);
				continue;
			}
			switch (field) {
				case "cost":
					validateCost(literal, `${key}.cost`);
					break;
				case "contextWindow":
				case "maxTokens":
					if (literal !== null && (!Number.isSafeInteger(literal) || Number(literal) <= 0)) {
						invalid(`${key}.${field} must be a positive integer or null`);
					}
					break;
				case "input":
					if (
						!Array.isArray(literal) ||
						literal.length === 0 ||
						literal.some(input => input !== "text" && input !== "image") ||
						new Set(literal).size !== literal.length
					) {
						invalid(`${key}.input must contain unique text/image modalities`);
					}
					break;
				case "reasoning":
					if (typeof literal !== "boolean") invalid(`${key}.reasoning must be boolean`);
					break;
				case "efforts": {
					if (!Array.isArray(literal)) invalid(`${key}.efforts must be an ordered effort array`);
					let previous = -1;
					for (const effort of literal) {
						const index = THINKING_EFFORTS.indexOf(effort);
						if (index <= previous)
							invalid(`${key}.efforts must contain unique supported efforts in ascending order`);
						previous = index;
					}
					break;
				}
			}
		}
	}
}

export const cfgModelFactsEnabled = register({
	id: "modelFacts.enabled",
	type: "boolean",
	default: false,
	validate: value => {
		if (value !== undefined && typeof value !== "boolean") invalid("enabled must be boolean");
	},
});
export const cfgModelFactsSources = register({
	id: "modelFacts.sources",
	type: "array",
	default: DEFAULT_MODEL_FACT_CONFIG.sources,
	validate: value => {
		if (value !== undefined) validateModelFactSources(value);
	},
});
export const cfgModelFactsOverrides = register({
	id: "modelFacts.overrides",
	type: "record",
	default: DEFAULT_MODEL_FACT_CONFIG.overrides,
	validate: value => {
		if (value !== undefined) validateModelFactOverrides(value);
	},
});

export function getModelFactConfig(scope: ScopeLike): ModelFactConfig {
	return {
		enabled: cfgModelFactsEnabled.get(scope),
		sources: cfgModelFactsSources.get(scope),
		overrides: cfgModelFactsOverrides.get(scope),
	};
}

interface SourceIndex {
	source: string;
	exact: Map<string, Model<Api>[]>;
	candidates: Map<string, Model<Api>[]>;
}

interface ResolutionContext {
	sources: readonly SourceIndex[];
	references: ReadonlyMap<string, { model: Model<Api>; source?: string }>;
}

function keyOf(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function indexModels(
	snapshots: readonly ModelFactSourceSnapshot[],
	references: readonly Model<Api>[],
): ResolutionContext {
	const referenceMap = new Map<string, { model: Model<Api>; source?: string }>();
	for (const model of references) referenceMap.set(keyOf(model), { model });
	const sources = snapshots.map(snapshot => {
		const exact = new Map<string, Model<Api>[]>();
		const candidates = new Map<string, Model<Api>[]>();
		for (const model of snapshot.models) {
			if (!referenceMap.has(keyOf(model))) referenceMap.set(keyOf(model), { model, source: snapshot.source });
			const id = model.id.toLowerCase();
			const equal = exact.get(id);
			if (equal) equal.push(model);
			else exact.set(id, [model]);
			for (const candidate of new Set(getReferenceCandidateIds(model.id).map(value => value.toLowerCase()))) {
				const matches = candidates.get(candidate);
				if (matches) matches.push(model);
				else candidates.set(candidate, [model]);
			}
		}
		return { source: snapshot.source, exact, candidates };
	});
	return { sources, references: referenceMap };
}

function compatibleIdentity(target: Model<Api>, candidate: Model<Api>): boolean {
	const left = target.identity;
	const right = candidate.identity;
	if (left.class !== "unknown" && right.class !== "unknown" && left.class !== right.class) return false;
	if (left.family && right.family && left.family !== right.family) return false;
	if (left.revision && right.revision && left.revision !== right.revision) return false;
	return left.effort === right.effort && left.thinkingVariant === right.thinkingVariant;
}

function matchSource(target: Model<Api>, source: SourceIndex, explicit?: string): Model<Api> | undefined {
	if (explicit) {
		const slash = explicit.indexOf("/");
		return source.exact.get(explicit.slice(slash + 1).toLowerCase())?.find(model => keyOf(model) === explicit);
	}
	const exact = source.exact.get(target.id.toLowerCase());
	const local = exact?.find(model => model.provider === target.provider);
	if (local) return local;
	const equal = exact?.find(model => compatibleIdentity(target, model));
	if (equal) return equal;
	// Opaque gateway IDs are not model identities, even if their suffix resembles one.
	if (target.id.startsWith("@")) return undefined;
	for (const candidate of getReferenceCandidateIds(target.id)) {
		const matches = source.candidates.get(candidate.toLowerCase());
		const found = matches?.find(model => compatibleIdentity(target, model));
		if (found) return found;
	}
	return undefined;
}

function factValue<Field extends ModelFactField>(model: Model<Api>, field: Field): ModelFactValues[Field] {
	return (
		field === "efforts" ? (model.thinking?.efforts ?? []) : model[field as Exclude<ModelFactField, "efforts">]
	) as ModelFactValues[Field];
}

function hasFact(model: Model<Api>, field: ModelFactField): boolean {
	switch (field) {
		case "cost":
			return [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite].some(
				rate => rate > 0,
			);
		case "contextWindow":
			return !model.discoveryMissingContextWindow && model.contextWindow !== null && model.contextWindow > 0;
		case "maxTokens":
			return !model.discoveryMissingMaxTokens && model.maxTokens !== null && model.maxTokens > 0;
		case "input":
			return (
				model.input.length > 0 &&
				!(model.discoveryMissingInput && model.input.length === 1 && model.input[0] === "text")
			);
		case "reasoning":
			return model.reasoning && !model.thinking?.unverified;
		case "efforts":
			return !model.thinking?.unverified && (model.thinking?.efforts.length ?? 0) > 0;
	}
}

function thinkingWithEfforts(
	target: Model<Api>,
	efforts: readonly Effort[],
	source?: Model<Api>,
): ThinkingConfig | undefined {
	if (efforts.length === 0) return undefined;
	const policy =
		target.thinking ??
		resolveModelPolicy({
			...target,
			reasoning: true,
			thinking: undefined,
			compat: target.compatConfig,
		}).thinking;
	// Only the target's policy may provide wire maps, budgets, or routed model IDs.
	const template: ThinkingConfig = policy ?? { mode: source?.thinking?.mode ?? "effort", efforts };
	return {
		...template,
		efforts,
		unverified: undefined,
		defaultLevel:
			template.defaultLevel && efforts.includes(template.defaultLevel) ? template.defaultLevel : undefined,
	};
}

function resolveWithContext(
	target: Model<Api>,
	context: ResolutionContext,
	overrides: ModelFactOverrides,
	options: ModelFactResolveOptions,
): ModelFactResolution {
	const provenance: ModelFactResolution["provenance"] = {};
	const issues: string[] = [];
	const values: ModelFactValues = {
		cost: target.cost,
		contextWindow: target.contextWindow,
		maxTokens: target.maxTokens,
		input: target.input,
		reasoning: target.reasoning,
		efforts: target.thinking?.efforts ?? [],
	};
	const filled = new Set<ModelFactField>();
	for (const field of MODEL_FACT_FIELDS) {
		if (hasFact(target, field) && !options.missingFields?.includes(field)) {
			filled.add(field);
			provenance[field] = { kind: "provider", provider: target.provider, model: target.id };
		}
	}
	let effortSource: Model<Api> | undefined;
	const set = <Field extends ModelFactField>(
		field: Field,
		value: ModelFactValues[Field],
		origin: ModelFactProvenance,
	): void => {
		values[field] = value;
		filled.add(field);
		provenance[field] = origin;
	};
	for (const snapshot of context.sources) {
		const model = matchSource(target, snapshot, options.matches?.[keyOf(target)]);
		if (!model) continue;
		for (const field of MODEL_FACT_FIELDS) {
			if (filled.has(field) || !hasFact(model, field)) continue;
			set(field, factValue(model, field), {
				kind: "source",
				source: snapshot.source,
				provider: model.provider,
				model: model.id,
			});
			if (field === "efforts") effortSource = model;
		}
	}
	const override = overrides[keyOf(target)];
	if (override) {
		for (const field of MODEL_FACT_FIELDS) {
			const value = override[field];
			if (value === undefined) continue;
			if (isModelFactReference(value)) {
				const reference = context.references.get(value.from);
				if (!reference) {
					issues.push(`${keyOf(target)}.${field}: model reference ${value.from} was not found`);
					continue;
				}
				set(field, factValue(reference.model, field), {
					kind: "reference",
					provider: reference.model.provider,
					model: reference.model.id,
					source: reference.source,
				});
				if (field === "efforts") effortSource = reference.model;
			} else {
				set(field, value as ModelFactValues[typeof field], { kind: "override" });
			}
		}
	}
	// An explicit reasoning pin wins. Otherwise, a listed ladder corrects a false negative.
	if (values.efforts.length > 0 && override?.reasoning === undefined && !values.reasoning) {
		values.reasoning = true;
		provenance.reasoning = provenance.efforts;
	}
	const resolvedContext = target.discoveryMissingContextWindow && provenance.contextWindow !== undefined;
	const resolvedOutput = target.discoveryMissingMaxTokens && provenance.maxTokens !== undefined;
	const changed =
		values.cost !== target.cost ||
		values.contextWindow !== target.contextWindow ||
		values.maxTokens !== target.maxTokens ||
		values.input !== target.input ||
		values.reasoning !== target.reasoning ||
		(values.efforts !== target.thinking?.efforts && values.efforts.length > 0) ||
		override?.efforts !== undefined ||
		resolvedContext ||
		resolvedOutput ||
		(target.discoveryMissingInput === true && provenance.input !== undefined && provenance.input.kind !== "provider");
	if (!changed) return { model: target, provenance, issues };
	const { efforts, ...facts } = values;
	const thinking =
		efforts === target.thinking?.efforts ? target.thinking : thinkingWithEfforts(target, efforts, effortSource);
	// Capability changes must also refresh the target provider's derived wire policy.
	const model =
		values.reasoning !== target.reasoning || thinking !== target.thinking
			? buildModel({ ...toModelSpec(target), ...facts, thinking })
			: { ...target };
	// These are field-level operator/source facts, not new catalog defaults.
	Object.assign(model, facts);
	model.thinking = thinking;
	model.discoveryMissingInput =
		provenance.input && provenance.input.kind !== "provider" ? undefined : target.discoveryMissingInput;
	model.discoveryMissingContextWindow = resolvedContext ? undefined : target.discoveryMissingContextWindow;
	model.discoveryMissingMaxTokens = resolvedOutput ? undefined : target.discoveryMissingMaxTokens;
	if (provenance.cost?.kind !== "provider") {
		// A zero placeholder's unknown/included label must not hide a resolved rate card.
		model.pricingStatus = model.cost.input > 0 || model.cost.output > 0 ? undefined : model.pricingStatus;
	}
	return { model, provenance, issues };
}

/** Resolve fields without I/O. Source snapshots are consulted in their supplied order. */
export function resolveModelFacts(
	target: Model<Api>,
	snapshots: readonly ModelFactSourceSnapshot[],
	overrides: ModelFactOverrides = {},
	referenceModels: readonly Model<Api>[] = [],
	options: ModelFactResolveOptions = {},
): ModelFactResolution {
	return resolveWithContext(target, indexModels(snapshots, [target, ...referenceModels]), overrides, options);
}

/** Apply a configured chain and add explicit override-only rows using target-provider transport. */
export function applyModelFacts(
	models: readonly Model<Api>[],
	snapshots: readonly ModelFactSourceSnapshot[],
	config: ModelFactConfig,
	options: ModelFactApplyOptions = {},
): ModelFactResolution[] {
	if (!config.enabled)
		return models.map(model => {
			const provenance: ModelFactResolution["provenance"] = {};
			for (const field of MODEL_FACT_FIELDS) {
				if (hasFact(model, field))
					provenance[field] = { kind: "provider", provider: model.provider, model: model.id };
			}
			return { model, provenance, issues: [] };
		});
	const targets = [...models];
	const keys = new Set(models.map(keyOf));
	for (const key of Object.keys(config.overrides)) {
		if (keys.has(key)) continue;
		const slash = key.indexOf("/");
		const model = options.createModel?.(key.slice(0, slash), key.slice(slash + 1));
		if (model) {
			targets.push(model);
			keys.add(key);
		}
	}
	const indexed = indexModels(snapshots, [...targets, ...(options.referenceModels ?? [])]);
	const context: ResolutionContext = {
		...indexed,
		sources: config.sources.flatMap(source => indexed.sources.filter(snapshot => snapshot.source === source)),
	};
	return targets.map(model =>
		resolveWithContext(model, context, config.overrides, {
			missingFields: options.missingFields?.get(keyOf(model)),
			matches: options.matches,
		}),
	);
}
