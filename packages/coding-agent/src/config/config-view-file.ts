import * as path from "node:path";
import { SETTINGS_TOML } from "./settings-toml";

export type ConfigViewTarget =
	| { kind: "settings"; scope?: "global" | "project" }
	| { kind: "models"; section: "roles" | "effort" | "context" | "overrides"; scope?: "global" | "project" }
	| { kind: "advisor" | "agent"; filePath?: string };

export interface ConfigViewFiles {
	settings: { getConfigFile(scope?: "global" | "project"): string };
	models: { getConfigFile(): string };
}

/** One mapping for every config view. Existing TOML companions win over YAML. */
export async function resolveConfigViewFile(
	target: ConfigViewTarget,
	files: ConfigViewFiles,
): Promise<string | undefined> {
	let filePath: string | undefined;
	let settingsFile = false;
	switch (target.kind) {
		case "settings":
			filePath = files.settings.getConfigFile(target.scope);
			settingsFile = true;
			break;
		case "models":
			settingsFile = target.section !== "overrides";
			filePath = settingsFile ? files.settings.getConfigFile(target.scope) : files.models.getConfigFile();
			break;
		case "advisor":
		case "agent":
			filePath = target.filePath;
			break;
	}
	if (!filePath) return undefined;
	if (/\.ya?ml$/i.test(filePath)) {
		const toml = filePath.replace(/\.ya?ml$/i, ".toml");
		if (await Bun.file(toml).exists()) return toml;
		// The existing settings overlay predates same-name config.toml support.
		if (settingsFile) {
			const overlay = path.join(path.dirname(filePath), SETTINGS_TOML);
			if (await Bun.file(overlay).exists()) return overlay;
		}
	}
	return filePath;
}
