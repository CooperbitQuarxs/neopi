import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AgentStorage } from "../src/session/agent-storage";
import { observeThemesConfiguration } from "../src/modes/themes-configuration";
import { beginSettingsTest, restoreSettingsTestState } from "./helpers/settings-test-state";
import { Settings } from "../src/config/settings";
import { cfgThemeDark, cfgThemeLight } from "../src/modes/settings";
import { getThemesConfiguration, RpcThemeConflict, updateTheme } from "../src/modes/rpc/rpc-themes-configuration";

describe("native theme configuration", () => {
	test("project selection wins and removing it reveals the untouched user selection", async () => {
		const settings = Settings.isolated({});
		cfgThemeDark.set(settings, "dark");
		cfgThemeLight.set(settings, "light");
		const result = await updateTheme(settings, {
			type: "update_theme",
			appearance: "dark",
			scope: "project",
			name: "light",
			expected: null,
		});
		expect(result.selection.dark).toMatchObject({ effective: "light", global: "dark", project: "light" });
		expect(result.selection.light.effective).toBe("light");
		const restored = await updateTheme(settings, {
			type: "update_theme",
			appearance: "dark",
			scope: "project",
			name: null,
			expected: "light",
		});
		expect(restored.selection.dark).toMatchObject({ effective: "dark", global: "dark", project: null });
		expect(restored.selection.dark.colors).not.toEqual(result.selection.dark.colors);
	});

	test("stale writes do not overwrite another client's scoped selection", async () => {
		const settings = Settings.isolated({});
		cfgThemeDark.set(settings, "dark");
		await expect(
			updateTheme(settings, {
				type: "update_theme",
				appearance: "dark",
				scope: "global",
				name: "light",
				expected: null,
			}),
		).rejects.toBeInstanceOf(RpcThemeConflict);
		expect(cfgThemeDark.get(settings)).toBe("dark");
	});

	test("rejects paths and absent definitions without modifying either slot", async () => {
		const settings = Settings.isolated({});
		const before = await getThemesConfiguration(settings);
		await expect(
			updateTheme(settings, {
				type: "update_theme",
				appearance: "dark",
				scope: "project",
				name: "../../config",
				expected: null,
			}),
		).rejects.toThrow("Unknown native theme");
		const after = await getThemesConfiguration(settings);
		expect(after.selection).toEqual(before.selection);
		expect(after.themes).toContain(after.selection.light.effective);
	});
	test("invalidates a shadowed user edit on disk reload and reveals it after project inheritance", async () => {
		const state = beginSettingsTest();
		const scratch = path.join(os.homedir(), ".cache", "npi-canary");
		await fs.mkdir(scratch, { recursive: true });
		const root = await fs.mkdtemp(path.join(scratch, "native-theme-scopes-"));
		const cwd = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const instances: Settings[] = [];
		let stop: (() => void) | undefined;
		try {
			delete process.env.PI_CONFIG_FILES;
			await fs.mkdir(cwd, { recursive: true });
			const writer = await Settings.loadIsolated({ cwd, agentDir });
			instances.push(writer);
			await updateTheme(writer, {
				type: "update_theme",
				appearance: "dark",
				scope: "global",
				name: "dark",
				expected: null,
			});
			await updateTheme(writer, {
				type: "update_theme",
				appearance: "dark",
				scope: "project",
				name: "dark",
				expected: null,
			});
			const reader = await Settings.loadIsolated({ cwd, agentDir });
			instances.push(reader);
			let changes = 0;
			stop = observeThemesConfiguration(reader, () => changes++);
			await updateTheme(writer, {
				type: "update_theme",
				appearance: "dark",
				scope: "global",
				name: "light",
				expected: "dark",
			});
			await reader.reloadFromDisk();
			expect(changes).toBe(1);
			const hidden = await getThemesConfiguration(reader);
			expect(hidden.selection.dark).toMatchObject({ effective: "dark", global: "light", project: "dark" });
			expect(changes).toBe(1);
			await updateTheme(writer, {
				type: "update_theme",
				appearance: "dark",
				scope: "project",
				name: null,
				expected: "dark",
			});
			await reader.reloadFromDisk();
			expect(changes).toBe(2);
			const revealed = await getThemesConfiguration(reader);
			expect(revealed.selection.dark).toMatchObject({ effective: "light", global: "light", project: null });
		} finally {
			stop?.();
			for (const settings of instances) settings.cancelPendingSaves();
			AgentStorage.close();
			restoreSettingsTestState(state);
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
