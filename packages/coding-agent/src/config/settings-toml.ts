import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isEnoent, isRecord } from "@oh-my-pi/pi-utils";
import { orderedSettings } from "./all-settings";

export const SETTINGS_TOML = "settings.toml";
export const CONFIG_TOML = "config.toml";

/** Read the canonical sibling, or the legacy overlay, but never combine both. */
async function settingsTomlSource(directory: string): Promise<{ filePath: string; content: string } | undefined> {
	const sources: { filePath: string; content: string }[] = [];
	for (const filename of [CONFIG_TOML, SETTINGS_TOML]) {
		const filePath = path.join(directory, filename);
		try {
			sources.push({ filePath, content: await Bun.file(filePath).text() });
		} catch (error) {
			if (!isEnoent(error)) throw new Error(`Failed to read settings config ${filePath}`, { cause: error });
		}
	}
	if (sources.length > 1) {
		throw new Error(
			`Conflicting settings files: ${sources.map(source => source.filePath).join(" and ")}. Keep only one TOML sibling.`,
		);
	}
	return sources[0];
}

/** Selected main-settings overlay path for file viewers and other read-side consumers. */
export async function resolveSettingsTomlPath(directory: string): Promise<string | undefined> {
	return (await settingsTomlSource(directory))?.filePath;
}

/** Missing and empty overlays leave the original layer untouched. This reader never writes settings. */
export async function readSettingsToml(directory: string): Promise<Record<string, unknown>> {
	const source = await settingsTomlSource(directory);
	if (!source) return {};
	try {
		return parseSettingsToml(source.content);
	} catch (error) {
		throw new Error(`Settings config is invalid: ${source.filePath}: ${String(error)}`);
	}
}

export function parseSettingsToml(content: string): Record<string, unknown> {
	const parsed: unknown = Bun.TOML.parse(content);
	if (!isRecord(parsed)) throw new Error("Expected a settings table");
	return decodeSettingsToml(parsed);
}

/** Top-level keys, including tables and arrays, replace their YAML counterparts wholesale. */
export function overlaySettingsToml(
	base: Record<string, unknown>,
	overlay: Record<string, unknown> = {},
): Record<string, unknown> {
	overlay = decodeSettingsToml(overlay);
	if (Object.keys(overlay).length === 0) return base;
	return Object.fromEntries([
		...Object.entries(base),
		...Object.entries(overlay).filter(([, value]) => value !== undefined),
	]);
}

function plainTable(value: unknown): value is Record<string, unknown> {
	return (
		isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}

function pointerSegment(key: string): string {
	return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function tomlString(value: string, multiline = true): string {
	// Bun currently swaps the \t and \f escapes. A literal tab is valid TOML
	// and avoids changing user text. It also retains a leading multiline LF
	// instead of trimming it, so never emit the optional opening newline.
	const quote = (text: string) =>
		`"${text
			.split("\t")
			.map(part => JSON.stringify(part).slice(1, -1))
			.join("\t")}"`;
	if (multiline && value.includes("\n") && !value.startsWith("\n")) {
		return `"""${value
			.split("\n")
			.map(line => quote(line).slice(1, -1))
			.join("\n")}"""`;
	}
	return quote(value);
}

function tomlValue(value: unknown, multiline = false): string {
	if (typeof value === "string") return tomlString(value, multiline);
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") {
		if (Number.isNaN(value)) return "nan";
		if (value === Infinity) return "inf";
		if (value === -Infinity) return "-inf";
		if (Object.is(value, -0)) return "-0.0";
		return String(value);
	}
	if (Array.isArray(value)) return `[${value.map(entry => tomlValue(entry)).join(", ")}]`;
	if (plainTable(value)) {
		return `{ ${Object.entries(value)
			.map(([key, entry]) => `${tomlString(key, false)} = ${tomlValue(entry)}`)
			.join(", ")} }`;
	}
	throw new Error("Cannot represent value in TOML");
}

/** Restore versioned JSON Pointer clears before the YAML top-level overlay is applied. */
export function decodeSettingsToml(input: Record<string, unknown>): Record<string, unknown> {
	if (!Object.hasOwn(input, "__npi")) return input;
	const metadata = input.__npi;
	if (
		!plainTable(metadata) ||
		metadata.version !== 1 ||
		!Array.isArray(metadata.null_paths) ||
		!metadata.null_paths.every(entry => typeof entry === "string") ||
		Object.keys(metadata).some(key => key !== "version" && key !== "null_paths")
	)
		throw new Error("Invalid reserved __npi metadata. Expected version = 1 and null_paths = [JSON Pointers].");
	const decoded = structuredClone(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "__npi")));
	const seen = new Set<string>();
	for (const pointer of metadata.null_paths as string[]) {
		if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer) || seen.has(pointer)) {
			throw new Error(`Invalid or duplicate null path: ${JSON.stringify(pointer)}`);
		}
		seen.add(pointer);
		const segments = pointer
			.slice(1)
			.split("/")
			.map(segment => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
		if (segments[0] === "__npi") throw new Error("Null paths cannot target reserved __npi metadata");
		let parent: unknown = decoded;
		for (const [index, segment] of segments.entries()) {
			const last = index === segments.length - 1;
			if (Array.isArray(parent)) {
				if (!/^(0|[1-9]\d*)$/.test(segment) || Number(segment) >= parent.length) {
					throw new Error(`Null path has an invalid array index: ${JSON.stringify(pointer)}`);
				}
				if (last) {
					if (parent[Number(segment)] !== "")
						throw new Error(`Null array placeholder must be an empty string: ${JSON.stringify(pointer)}`);
					parent[Number(segment)] = null;
				} else parent = parent[Number(segment)];
			} else if (plainTable(parent)) {
				if (last) {
					if (Object.hasOwn(parent, segment))
						throw new Error(`Null path conflicts with a value: ${JSON.stringify(pointer)}`);
					Object.defineProperty(parent, segment, {
						value: null,
						enumerable: true,
						writable: true,
						configurable: true,
					});
				} else {
					if (!Object.hasOwn(parent, segment))
						throw new Error(`Null path has a missing parent: ${JSON.stringify(pointer)}`);
					parent = parent[segment];
				}
			} else throw new Error(`Null path has a non-table parent: ${JSON.stringify(pointer)}`);
		}
	}
	return decoded;
}

/** Encode the complete user mapping, including unknown keys and explicit nulls. */
export function stringifySettingsToml(settings: Record<string, unknown>): string {
	if (!plainTable(settings)) throw new Error("Settings must contain a mapping at the document root");
	if (Object.hasOwn(settings, "__npi"))
		throw new Error("/__npi: reserved TOML metadata key conflicts with user configuration");
	const nullPaths: string[] = [];
	const ancestors = new Set<object>();
	function encode(value: unknown, pointer: string): unknown {
		if (value === null) {
			nullPaths.push(pointer);
			return "";
		}
		if (typeof value === "string") {
			if (/[\u0000-\u0007\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)) {
				throw new Error(
					`${pointer}: string contains control characters or unpaired surrogates the TOML reader cannot recover`,
				);
			}
			return value;
		}
		if (typeof value === "boolean") return value;
		if (typeof value === "number") {
			if (Number.isInteger(value) && !Number.isSafeInteger(value))
				throw new Error(`${pointer}: integer is outside the exact reader range`);
			return value;
		}
		if (!Array.isArray(value) && !plainTable(value)) {
			throw new Error(`${pointer || "/"}: unsupported ${value instanceof Date ? "date/time" : typeof value} value`);
		}
		if (ancestors.has(value)) throw new Error(`${pointer}: cyclic YAML aliases cannot be represented`);
		ancestors.add(value);
		try {
			if (Array.isArray(value)) return value.map((entry, index) => encode(entry, `${pointer}/${index}`));
			return Object.fromEntries(
				Object.entries(value).flatMap(([key, entry]) => {
					encode(key, `${pointer}/${pointerSegment(key)}`);
					const encoded = encode(entry, `${pointer}/${pointerSegment(key)}`);
					return entry === null ? [] : [[key, encoded]];
				}),
			);
		} finally {
			ancestors.delete(value);
		}
	}
	const encoded = encode(settings, "") as Record<string, unknown>;
	if (nullPaths.length) encoded.__npi = { version: 1, null_paths: nullPaths };
	const lines: string[] = [];
	function table(value: Record<string, unknown>, keys: string[], header?: string): void {
		if (header) {
			if (lines.length) lines.push("");
			lines.push(header);
		}
		const entries = Object.entries(value);
		const isTableArray = (entry: unknown): entry is Record<string, unknown>[] =>
			Array.isArray(entry) && entry.length > 0 && entry.every(plainTable);
		for (const [key, entry] of entries) {
			if (!plainTable(entry) && !isTableArray(entry))
				lines.push(`${tomlString(key, false)} = ${tomlValue(entry, true)}`);
		}
		for (const [key, entry] of entries) {
			const child = [...keys, key];
			const name = child.map(segment => tomlString(segment, false)).join(".");
			if (plainTable(entry)) table(entry, child, `[${name}]`);
			else if (isTableArray(entry)) for (const item of entry) table(item, child, `[[${name}]]`);
		}
	}
	table(encoded, []);
	const content = `${lines.join("\n")}\n`;
	if (!isDeepStrictEqual(parseSettingsToml(content), settings)) {
		throw new Error("TOML reader cannot recover the complete configuration exactly; no file was written");
	}
	return content;
}

/** Registry defaults only: never export user values, environment overrides, or credentials. */
export function dumpSettingsToml(): string {
	const lines = [
		"# NeoPi settings defaults. Regenerate with: npi config dump-toml",
		"# Save as config.toml beside config.yml to opt in; settings.toml is the legacy filename.",
		"# Each top-level TOML key replaces the whole YAML key, including nested tables.",
		"# Unset defaults stay commented because TOML has no null or undefined value.",
		"",
	];
	for (const setting of orderedSettings()) {
		lines.push(`# ${setting.id} (${setting.type})`);
		if (setting.ui?.description) lines.push(...setting.ui.description.split("\n").map(line => `# ${line}`));
		const key = setting.segments.map(segment => JSON.stringify(segment)).join(".");
		const value = setting.default;
		lines.push(
			value === undefined || value === null ? `# ${key} is unset by default` : `${key} = ${tomlValue(value)}`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}
