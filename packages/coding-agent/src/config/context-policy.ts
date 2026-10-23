import { logger } from "@oh-my-pi/pi-utils";
import { parseModelCompactionEntry } from "./compaction-threshold";
import { register } from "./registry";
import {
	compileSelectorRegex,
	isGlobSelectorPattern,
	isRegexSelectorPattern,
	matchValidatedModelSelectorRule,
	validateConfiguredModelRules,
} from "./selector-pattern";
import type { ScopeLike } from "./registry";

export interface ContextRule {
	selector: string;
	/** Same token base, fixed trigger, or percentage as the per-model N editor. */
	limit: number | string;
}

export const cfgContextRules = register({
	id: "context.rules",
	type: "array",
	default: [] as ContextRule[],
	validateConfigured: validateConfiguredModelRules,
	validate(raw) {
		if (raw === undefined) return;
		if (!Array.isArray(raw)) throw new Error("Context rules must be an ordered list");
		const seen = new Set<string>();
		for (const rule of raw) {
			if (
				!rule ||
				typeof rule !== "object" ||
				Array.isArray(rule) ||
				typeof rule.selector !== "string" ||
				!rule.selector.trim()
			)
				throw new Error("Each context rule must name a model selector");
			if (!isRegexSelectorPattern(rule.selector)) {
				const slash = rule.selector.indexOf("/");
				if (slash < 1 || slash === rule.selector.length - 1)
					throw new Error("Context rules must use provider/model selectors");
			}
			if (seen.has(rule.selector.toLowerCase())) throw new Error(`Duplicate context rule ${rule.selector}`);
			seen.add(rule.selector.toLowerCase());
			if (!parseModelCompactionEntry(rule.limit)) throw new Error(`Invalid context rule limit for ${rule.selector}`);
			if (isRegexSelectorPattern(rule.selector) && !compileSelectorRegex(rule.selector)) {
				logger.warn("Settings: skipping invalid context rule regex", { selector: rule.selector });
			} else if (isGlobSelectorPattern(rule.selector)) new Bun.Glob(rule.selector);
		}
	},
});

export function matchContextRule(scope: ScopeLike, model: { provider: string; id: string }): ContextRule | undefined {
	return matchValidatedModelSelectorRule(cfgContextRules.get(scope), model, rule => {
		cfgContextRules.definition.validate?.([rule]);
		return rule;
	});
}
