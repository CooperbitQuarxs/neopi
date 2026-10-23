export interface SpeechSegmentOptions {
	minChars: number;
	maxChars: number;
	firstChars: number;
	maxWords: number;
	sentences: boolean;
	commas: boolean;
	conjunctions: boolean;
	punctuation: boolean;
	ellipsis: boolean;
}

export const DEFAULT_SPEECH_SEGMENTS: SpeechSegmentOptions = {
	minChars: 80,
	maxChars: 240,
	firstChars: 80,
	maxWords: 40,
	sentences: true,
	commas: true,
	conjunctions: true,
	punctuation: true,
	ellipsis: true,
};

/** Ordered anchor ladder. Quotes and parentheses are indivisible, even across deltas.
 * The character/word targets are soft for an enclosed clause or a single long word.
 */
export function speechSegmentCut(text: string, first: boolean, options: SpeechSegmentOptions, final = false): number {
	const target = first ? options.firstChars : options.maxChars;
	const min = first ? Math.min(12, target) : Math.min(options.minChars, target);
	const anchors: number[][] = [[], [], [], [], []];
	const stack: string[] = [];
	let words = 0;
	let wordEnd = -1;
	let protectedEnd = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (ch === "(" || ch === "[" || ch === "“" || ch === '"') {
			if (stack.at(-1) === ch) stack.pop();
			else stack.push(ch === "(" ? ")" : ch === "[" ? "]" : ch === "“" ? "”" : ch);
		} else if (ch === stack.at(-1)) stack.pop();
		if (/\S/.test(ch) && (i === text.length - 1 || /\s/.test(text[i + 1]!))) {
			words++;
			if (words === options.maxWords) wordEnd = i + 1;
		}
		if (stack.length) continue;
		const end = i + 1;
		const boundary = end === text.length ? final : /\s/.test(text[end]!);
		if (!boundary) continue;
		if (end >= target || (wordEnd > 0 && end >= wordEnd)) protectedEnd = end;
		if (end > target || (wordEnd > 0 && end > wordEnd)) break;
		if (end < min) continue;
		anchors[4]!.push(end);
		const before = text.slice(0, end).replace(/[)\]”"]+$/, "");
		if (
			options.sentences &&
			(options.ellipsis ? /\.+$/ : /(?<!\.)\.$/).test(before) &&
			!/(?:\b(?:Mr|Mrs|Ms|Dr|St|vs|etc)|e\.g|i\.e)\.$/i.test(before)
		)
			anchors[0]!.push(end);
		else if (options.commas && before.endsWith(",")) anchors[1]!.push(end);
		else if (options.punctuation && /[:;!?"”)]$/.test(text.slice(0, end))) anchors[3]!.push(end);
		if (options.conjunctions && /^(?:and|or|because)\b/i.test(text.slice(end).trimStart())) anchors[2]!.push(end);
	}
	// Wait for enough lookahead to choose the best boundary, except a short first sentence.
	if (first && anchors[0]!.length) return anchors[0]![0]!;
	if (!final && text.length < target && wordEnd < 0) return -1;
	for (const tier of anchors) if (tier.length) return tier[tier.length - 1]!;
	// Never split inside a quoted/parenthesized clause or inside a word.
	if (protectedEnd > 0) return protectedEnd;
	return final ? text.length : -1;
}

export function splitSpeechText(text: string, options: SpeechSegmentOptions = DEFAULT_SPEECH_SEGMENTS): string[] {
	const segments: string[] = [];
	let rest = text.trim();
	while (rest) {
		const cut = speechSegmentCut(rest, segments.length === 0, options, true);
		segments.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trimStart();
	}
	return segments;
}
