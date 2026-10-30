import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	bindTheme,
	getCurrentThemeName,
	getResolvedThemeColors,
	getThemeExportColors,
	setTheme,
	theme,
} from "@oh-my-pi/pi-tui/theme";
import { getCustomThemesDir, setAgentDir } from "@oh-my-pi/pi-utils";
import darkTheme from "../../../tui/src/theme/dark.json" with { type: "json" };
import { Settings } from "../../src/config/settings";
import { getThemePalette, getThemesConfiguration, updateTheme } from "../../src/modes/rpc/rpc-themes-configuration";
import { AgentStorage } from "../../src/session/agent-storage";

// A separate process owns the active-theme singleton, so this test cannot repaint
// another test's session or leak its active selection into the shared test runner.
const scratch = path.join(os.homedir(), ".cache", "npi-canary");
await fs.mkdir(scratch, { recursive: true });
const root = await fs.mkdtemp(path.join(scratch, "native-theme-palette-"));
const cwd = path.join(root, "project");
const agentDir = path.join(root, "agent");
let settings: Settings | undefined;
let unbindTheme: (() => void) | undefined;
try {
	delete process.env.PI_CONFIG_FILES;
	setAgentDir(agentDir);
	await fs.mkdir(cwd, { recursive: true });
	const themesDir = getCustomThemesDir();
	assert.equal(themesDir, path.join(agentDir, "themes"));
	await fs.mkdir(themesDir, { recursive: true });
	const customName = "inactive-custom";
	const base = darkTheme;
	const custom = {
		...base,
		name: customName,
		vars: { ...base.vars, fixtureAccent: "#123456" },
		colors: { ...base.colors, accent: "fixtureAccent" },
		export: { pageBg: "#112233", cardBg: "#223344", infoBg: "#334455" },
	};
	const customPath = path.join(themesDir, `${customName}.json`);
	await fs.writeFile(customPath, JSON.stringify(custom));
	const customBytes = await fs.readFile(customPath);
	settings = await Settings.loadIsolated({ cwd, agentDir });
	for (const scope of ["global", "project"] as const) {
		await updateTheme(settings, { type: "update_theme", appearance: "dark", scope, name: "dark", expected: null });
	}
	assert.deepEqual(await setTheme("dark"), { success: true });
	assert.equal(getCurrentThemeName(), "dark");
	const activeTheme = theme;
	const before = await getThemesConfiguration(settings);
	const globalConfig = settings.getConfigFile("global");
	const projectConfig = settings.getConfigFile("project");
	const globalBytes = await fs.readFile(globalConfig);
	const projectBytes = await fs.readFile(projectConfig);
	let themeAssignments = 0;
	unbindTheme = bindTheme(() => themeAssignments++);
	themeAssignments = 0;

	for (const name of ["light", customName]) {
		assert.notEqual(name, getCurrentThemeName());
		const palette = await getThemePalette(name);
		const expectedColors = await getResolvedThemeColors(name);
		for (const [key, value] of Object.entries(await getThemeExportColors(name))) {
			if (value) expectedColors[key] = value;
		}
		assert.deepEqual(palette, { name, colors: expectedColors });
		if (name === customName) {
			assert.equal(palette.colors.accent, "#123456");
			assert.equal(palette.colors.pageBg, "#112233");
			assert.equal(palette.colors.cardBg, "#223344");
			assert.equal(palette.colors.infoBg, "#334455");
		}
		assert.equal(getCurrentThemeName(), "dark");
		assert.equal(theme, activeTheme);
		assert.equal(themeAssignments, 0);
		assert.deepEqual(await getThemesConfiguration(settings), before);
		assert.deepEqual(await fs.readFile(globalConfig), globalBytes);
		assert.deepEqual(await fs.readFile(projectConfig), projectBytes);
	}
	await assert.rejects(getThemePalette("../../config"), /Unknown native theme/);
	await assert.rejects(getThemePalette("missing-native-theme"), /Unknown native theme/);
	assert.equal(getCurrentThemeName(), "dark");
	assert.equal(theme, activeTheme);
	assert.equal(themeAssignments, 0);
	assert.deepEqual(await getThemesConfiguration(settings), before);
	assert.deepEqual(await fs.readFile(globalConfig), globalBytes);
	assert.deepEqual(await fs.readFile(projectConfig), projectBytes);
	assert.deepEqual(await fs.readFile(customPath), customBytes);
} finally {
	unbindTheme?.();
	settings?.cancelPendingSaves();
	AgentStorage.close();
	await fs.rm(root, { recursive: true, force: true });
}
