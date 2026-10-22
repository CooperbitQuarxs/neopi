import { getAvailableThemes, getResolvedThemeColors, getThemeExportColors } from "@oh-my-pi/pi-tui/theme";
import { isRecord } from "@oh-my-pi/pi-utils";
import type { Settings } from "../../config/settings";
import { cfgThemeDark, cfgThemeLight } from "../settings";

export type RpcThemeAppearance = "dark" | "light";
export type RpcThemeScope = "global" | "project";
export interface RpcThemeSelection {
	effective: string;
	global: string | null;
	project: string | null;
	colors: Record<string, string>;
}
export interface RpcThemesConfiguration {
	themes: string[];
	selection: Record<RpcThemeAppearance, RpcThemeSelection>;
}
export type RpcThemesCommand =
	| { id?: string; type: "get_themes_configuration" }
	| {
			id?: string;
			type: "update_theme";
			appearance: RpcThemeAppearance;
			scope: RpcThemeScope;
			name: string | null;
			expected: string | null;
	  };

function storedTheme(layer: unknown, appearance: RpcThemeAppearance): string | null {
	if (!isRecord(layer) || !isRecord(layer.theme)) return null;
	const value = layer.theme[appearance];
	return typeof value === "string" ? value : null;
}

/** The terminal owns discovery, variable resolution and scope precedence. */
export async function getThemesConfiguration(settings: Settings): Promise<RpcThemesConfiguration> {
	await settings.reloadFromDisk();
	const global = settings.getGlobalSettings();
	const project = settings.getProjectSettings();
	const selection = async (appearance: RpcThemeAppearance): Promise<RpcThemeSelection> => {
		const name = (appearance === "dark" ? cfgThemeDark : cfgThemeLight).get(settings);
		const [colors, exported] = await Promise.all([getResolvedThemeColors(name), getThemeExportColors(name)]);
		for (const [key, value] of Object.entries(exported)) if (value) colors[key] = value;
		return { effective: name, global: storedTheme(global, appearance), project: storedTheme(project, appearance), colors };
	};
	const [themes, dark, light] = await Promise.all([getAvailableThemes(), selection("dark"), selection("light")]);
	return { themes, selection: { dark, light } };
}

export class RpcThemeConflict extends Error {}

/** A null name removes only the chosen scope, revealing its inherited value. */
export async function updateTheme(settings: Settings, command: Extract<RpcThemesCommand, { type: "update_theme" }>): Promise<RpcThemesConfiguration> {
	if (command.appearance !== "dark" && command.appearance !== "light") throw new Error("Invalid theme appearance.");
	if (command.scope !== "global" && command.scope !== "project") throw new Error("Invalid theme scope.");
	if (command.expected !== null && typeof command.expected !== "string") throw new Error("Expected theme value is required.");
	if (command.name !== null) {
		if (typeof command.name !== "string" || !(await getAvailableThemes()).includes(command.name)) throw new Error("Unknown native theme.");
		// Validate and resolve the definition before changing persisted settings.
		await getResolvedThemeColors(command.name);
	}
	await settings.reloadFromDisk();
	const layer = command.scope === "global" ? settings.getGlobalSettings() : settings.getProjectSettings();
	if (storedTheme(layer, command.appearance) !== command.expected) throw new RpcThemeConflict("The native theme changed in another client. Refresh before applying your choice.");
	const setting = command.appearance === "dark" ? cfgThemeDark : cfgThemeLight;
	const receipt = await settings.persistWithReceipt(() => {
		if (command.scope === "project") settings.writeProjectValue(setting, command.name ?? undefined);
		else if (command.name === null) setting.unset(settings);
		else setting.set(settings, command.name);
	});
	if (receipt.status === "conflict") {
		throw new RpcThemeConflict("Another client changed this native theme while it was being saved. Refresh before applying your choice.");
	}
	return getThemesConfiguration(settings);
}
