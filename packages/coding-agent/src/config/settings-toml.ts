import * as path from "node:path";
import { isEnoent, isRecord } from "@oh-my-pi/pi-utils";
import { orderedSettings } from "./all-settings";

export const SETTINGS_TOML = "settings.toml";

/** Missing and empty overlays leave the original layer untouched. Never write this file implicitly. */
export async function readSettingsToml(directory: string): Promise<Record<string, unknown>> {
	const filePath = path.join(directory, SETTINGS_TOML);
	let content: string;
	try {
		content = await Bun.file(filePath).text();
	} catch (error) {
		if (isEnoent(error)) return {};
		throw new Error(`Failed to read settings config ${filePath}: ${String(error)}`);
	}
	try {
		const parsed: unknown = Bun.TOML.parse(content);
		if (!isRecord(parsed)) throw new Error("Expected a settings table");
		return parsed;
	} catch (error) {
		throw new Error(`Settings config is invalid: ${filePath}: ${String(error)}`);
	}
}

/** Top-level keys, including tables and arrays, replace their YAML counterparts wholesale. */
export function overlaySettingsToml(
	base: Record<string, unknown>,
	overlay: Record<string, unknown> = {},
): Record<string, unknown> {
	if (Object.keys(overlay).length === 0) return base;
	return Object.fromEntries([
		...Object.entries(base),
		...Object.entries(overlay).filter(([, value]) => value !== undefined),
	]);
}

function tomlValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
	if (isRecord(value)) {
		return `{ ${Object.entries(value)
			.map(([key, entry]) => `${JSON.stringify(key)} = ${tomlValue(entry)}`)
			.join(", ")} }`;
	}
	throw new Error(`Cannot represent settings default in TOML: ${String(value)}`);
}

/** Registry defaults only: never export user values, environment overrides, or credentials. */
export function dumpSettingsToml(): string {
	const lines = [
		"# NeoPi settings defaults. Regenerate with: npi config dump-toml",
		"# Save as settings.toml beside config.yml to opt in.",
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
