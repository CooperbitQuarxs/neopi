import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "./fs-error";
import { isRecord } from "./type-guards";
export const SETTINGS_TOML = "settings.toml";
export const CONFIG_TOML = "config.toml";

/** Read the canonical sibling, or the legacy overlay, but never combine both. */
export async function settingsTomlSource(
	directory: string,
): Promise<{ filePath: string; content: string } | undefined> {
	const sources: { filePath: string; content: string }[] = [];
	for (const filename of [CONFIG_TOML, SETTINGS_TOML]) {
		const filePath = path.join(directory, filename);
		try {
			sources.push({ filePath, content: await fs.readFile(filePath, "utf8") });
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

export function parseSettingsToml(content: string, filePath?: string): Record<string, unknown> {
	try {
		const parsed: unknown = Bun.TOML.parse(content);
		if (!isRecord(parsed)) throw new Error("Expected a settings table");
		return decodeSettingsToml(parsed);
	} catch (error) {
		if (filePath) throw new Error(`Settings config is invalid: ${filePath}: ${String(error)}`);
		throw error;
	}
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

export function plainSettingsTomlTable(value: unknown): value is Record<string, unknown> {
	return (
		isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}
/** Restore versioned JSON Pointer clears before the YAML top-level overlay is applied. */
export function decodeSettingsToml(input: Record<string, unknown>): Record<string, unknown> {
	if (!Object.hasOwn(input, "__npi")) return input;
	const metadata = input.__npi;
	if (
		!plainSettingsTomlTable(metadata) ||
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
			} else if (plainSettingsTomlTable(parent)) {
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
