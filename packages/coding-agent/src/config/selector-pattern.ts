/** Explicit regular-expression selector patterns; unprefixed selectors retain their existing meaning. */
export function isRegexSelectorPattern(pattern: string): boolean {
	return pattern.startsWith("re:");
}

export function isGlobSelectorPattern(pattern: string): boolean {
	return !isRegexSelectorPattern(pattern) && /[*?[\]{}]/.test(pattern);
}

// Cache compiled expressions across settings validation and fallback turns. Invalid patterns
// are cached too, so a bad config cannot repeatedly throw during resolution.
const regexCache = new Map<string, RegExp | null>();

/** Compile an opt-in selector regex, returning undefined for an invalid expression. */
export function compileSelectorRegex(pattern: string): RegExp | undefined {
	const cached = regexCache.get(pattern);
	if (cached !== undefined) return cached ?? undefined;
	try {
		const regex = new RegExp(pattern.slice(3));
		regexCache.set(pattern, regex);
		return regex;
	} catch {
		regexCache.set(pattern, null);
		return undefined;
	}
}

/** Reject malformed authored patterns before persistence; loaded invalid rules remain read-safe. */
export function assertValidSelectorPattern(pattern: string): void {
	if (isRegexSelectorPattern(pattern)) {
		if (!compileSelectorRegex(pattern)) throw new Error(`Invalid model selector regex: ${pattern}`);
	} else if (isGlobSelectorPattern(pattern)) {
		new Bun.Glob(pattern);
	}
}

/** Match a selector without changing the existing literal and Bun glob behavior. */
export function matchesSelectorPattern(pattern: string, selector: string): boolean {
	if (isRegexSelectorPattern(pattern)) return compileSelectorRegex(pattern)?.test(selector) ?? false;
	if (isGlobSelectorPattern(pattern)) return new Bun.Glob(pattern).match(selector);
	return pattern === selector;
}

/** Exact ids outrank regexes, then globs. Declaration order breaks ties within each kind. */
export function matchModelSelectorRule<T extends { selector: string }>(
	rules: readonly T[],
	model: { provider: string; id: string },
): T | undefined {
	const identity = `${model.provider}/${model.id}`;
	const exact = rules.find(
		rule =>
			!isRegexSelectorPattern(rule.selector) &&
			!isGlobSelectorPattern(rule.selector) &&
			rule.selector.toLowerCase() === identity.toLowerCase(),
	);
	if (exact) return exact;
	const regex = rules.find(
		rule => isRegexSelectorPattern(rule.selector) && matchesSelectorPattern(rule.selector, identity),
	);
	if (regex) return regex;
	return rules.find(
		rule =>
			isGlobSelectorPattern(rule.selector) &&
			matchesSelectorPattern(rule.selector.toLowerCase(), identity.toLowerCase()),
	);
}

/** Keep invalid payloads local to their matching models without relaxing write-time validation. */
export function validateConfiguredModelRules(raw: unknown): void {
	if (raw !== undefined && !Array.isArray(raw)) throw new Error("Model rules must be an ordered list");
}

export function matchValidatedModelSelectorRule<T extends { selector: string }>(
	rules: readonly T[],
	model: { provider: string; id: string },
	validate: (rule: T) => T,
): T | undefined {
	const matching: T[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		// An absent or malformed selector cannot identify a model to block.
		if (!rule || typeof rule.selector !== "string" || !rule.selector.trim()) continue;
		if (!matchModelSelectorRule([rule], model)) continue;
		const key = rule.selector.toLowerCase();
		if (seen.has(key)) throw new Error(`Duplicate model rule ${rule.selector}`);
		seen.add(key);
		matching.push(validate(rule));
	}
	return matchModelSelectorRule(matching, model);
}
