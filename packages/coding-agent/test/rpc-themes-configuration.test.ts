import { describe, expect, test } from "bun:test";
import { Settings } from "../src/config/settings";
import { cfgThemeDark, cfgThemeLight } from "../src/modes/settings";
import { getThemesConfiguration, RpcThemeConflict, updateTheme } from "../src/modes/rpc/rpc-themes-configuration";

describe("native theme configuration", () => {
	test("project selection wins and removing it reveals the untouched user selection", async () => {
		const settings = Settings.isolated({});
		cfgThemeDark.set(settings, "dark");
		cfgThemeLight.set(settings, "light");
		const result = await updateTheme(settings, { type: "update_theme", appearance: "dark", scope: "project", name: "light", expected: null });
		expect(result.selection.dark).toMatchObject({ effective: "light", global: "dark", project: "light" });
		expect(result.selection.light.effective).toBe("light");
		const restored = await updateTheme(settings, { type: "update_theme", appearance: "dark", scope: "project", name: null, expected: "light" });
		expect(restored.selection.dark).toMatchObject({ effective: "dark", global: "dark", project: null });
		expect(restored.selection.dark.colors).not.toEqual(result.selection.dark.colors);
	});

	test("stale writes do not overwrite another client's scoped selection", async () => {
		const settings = Settings.isolated({});
		cfgThemeDark.set(settings, "dark");
		await expect(updateTheme(settings, { type: "update_theme", appearance: "dark", scope: "global", name: "light", expected: null })).rejects.toBeInstanceOf(RpcThemeConflict);
		expect(cfgThemeDark.get(settings)).toBe("dark");
	});

	test("rejects paths and absent definitions without modifying either slot", async () => {
		const settings = Settings.isolated({});
		const before = await getThemesConfiguration(settings);
		await expect(updateTheme(settings, { type: "update_theme", appearance: "dark", scope: "project", name: "../../config", expected: null })).rejects.toThrow("Unknown native theme");
		const after = await getThemesConfiguration(settings);
		expect(after.selection).toEqual(before.selection);
		expect(after.themes).toContain(after.selection.light.effective);
	});
});
