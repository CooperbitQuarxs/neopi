export interface MenuRegex {
	regex?: RegExp;
	error?: string;
}

// Filtering often calls the scalar matcher once per row, then paints the field.
// Keep that one active compilation shared without retaining old search strings.
let cachedQuery: string | undefined;
let cachedRegex: MenuRegex | undefined;

/** Ordinary patterns stay fuzzy; `/` and `re:` opt into the same Vim dialect. */
export function compileMenuRegex(query: string): MenuRegex | undefined {
	if (query === cachedQuery) return cachedRegex;
	cachedQuery = query;
	cachedRegex = undefined;
	const pattern = query.startsWith("/") ? query.slice(1) : query.startsWith("re:") ? query.slice(3) : undefined;
	if (pattern === undefined) return undefined;
	try {
		cachedRegex = { regex: translateVimRegex(pattern) };
	} catch (error) {
		cachedRegex = { error: error instanceof Error ? error.message : String(error) };
	}
	return cachedRegex;
}

function literal(character: string): string {
	return /[\\^$.*+?()[\]{}|/]/.test(character) ? `\\${character}` : character;
}

/** Translate Vim's magic switches and atoms, rather than treating Vim escapes as JS escapes. */
function translateVimRegex(pattern: string): RegExp {
	let source = "";
	let mode: "magic" | "nomagic" | "veryMagic" | "veryNomagic" = "veryMagic";
	let ignoreCase = true;
	for (let index = 0; index < pattern.length; index++) {
		let character = pattern[index]!;
		let escaped = false;
		if (character === "\\") {
			character = pattern[++index]!;
			if (character === undefined) throw new Error("Trailing backslash");
			escaped = true;
			if (character === "c" || character === "C") {
				ignoreCase = character === "c";
				continue;
			}
			if (character === "v" || character === "V" || character === "m" || character === "M") {
				mode = character === "v" ? "veryMagic" : character === "V" ? "veryNomagic" : character === "m" ? "magic" : "nomagic";
				continue;
			}
			if (/[dDwWsSnrt1-9]/.test(character)) {
				source += `\\${character}`;
				continue;
			}
		}
		const normallyMagic = mode === "veryMagic"
			? /[^\w\s]/.test(character)
			: mode === "magic" ? ".*[]^$".includes(character)
				: mode === "nomagic" ? "^$".includes(character) : false;
		const magic = escaped ? !normallyMagic : normallyMagic;
		if ((character === "<" || character === ">") && magic) {
			source += character === "<" ? "(?<!\\w)(?=\\w)" : "(?<=\\w)(?!\\w)";
			continue;
		}
		if (character === "[" && magic) {
			let collection = "[";
			if (pattern[index + 1] === "^") collection += pattern[++index];
			if (pattern[index + 1] === "]") {
				collection += "\\]";
				index++;
			}
			let closed = false;
			while (++index < pattern.length) {
				const member = pattern[index]!;
				collection += member;
				if (member === "\\") {
					const next = pattern[++index];
					if (next === undefined) throw new Error("Trailing backslash in collection");
					collection += next;
				} else if (member === "]") {
					closed = true;
					break;
				}
			}
			if (!closed) throw new Error("Unclosed character collection");
			source += collection;
		} else if (character === "{" && magic) {
			// Vim escapes the opening brace in magic mode, not the closing one.
			const end = pattern.indexOf("}", index + 1);
			if (end < 0) throw new Error("Unclosed repetition");
			const count = pattern.slice(index + 1, end).replace(/\\$/, "");
			if (!/^\d+(,\d*)?$|^,\d+$/.test(count)) throw new Error("Invalid repetition");
			source += `{${count}}`;
			index = end;
		} else {
			source += magic && ".*+?|()^$".includes(character) ? character : literal(character);
		}
	}
	return new RegExp(source, ignoreCase ? "iu" : "u");
}
