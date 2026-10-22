import type { Settings } from "../config/settings";
import { cfgThemeDark, cfgThemeLight } from "./settings";

/** Observe durable scopes, including a user theme hidden by a project override. */
export function observeThemesConfiguration(settings: Settings, notify: () => void): () => void {
	const key = () => JSON.stringify([
		cfgThemeDark.get(settings), cfgThemeLight.get(settings),
		settings.getGlobalSettings().theme, settings.getProjectSettings().theme,
	]);
	let previous = key();
	return settings.onPersistedLayersChange(() => {
		const next = key();
		if (next === previous) return;
		previous = next;
		notify();
	});
}
