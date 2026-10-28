import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Settings, resetSettingsForTest } from "../src/config/settings";
import { orderedSettings } from "../src/config/all-settings";
import { dumpSettingsToml, overlaySettingsToml } from "../src/config/settings-toml";
import { parseConfigArgs } from "../src/cli/config-cli";
import { cfgCompactionEnabled } from "../src/session/context-settings";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

let root = "";
let agentDir: string;
let cwd: string;
let state: SettingsTestState | undefined;
const yaml =
	"# Preserve this comment\ncompaction:\n  enabled: false\n  reserveTokens: 1234\nmodelRoles:\n  default: example/model\n  slow: example/other\n";
beforeEach(async () => {
	state = beginSettingsTest();
	const cacheDir = path.join(process.env.HOME!, ".cache/npi-canary");
	await fs.mkdir(cacheDir, { recursive: true });
	root = await fs.mkdtemp(path.join(cacheDir, "toml-overlay-test-"));
	agentDir = path.join(root, "agent");
	cwd = path.join(root, "project");
	await fs.mkdir(cwd, { recursive: true });
	await Bun.write(path.join(agentDir, "config.yml"), yaml);
	resetSettingsForTest();
});
afterEach(async () => {
	restoreSettingsTestState(state);
	if (root) await fs.rm(root, { recursive: true, force: true });
});
function snapshot(settings: Settings): string {
	return JSON.stringify(orderedSettings().map(setting => [setting.id, setting.get(settings)]));
}
describe("settings.toml", () => {
	it("keeps real Settings.init and YAML bytes unchanged without an overlay, including an empty overlay", async () => {
		const first = await Settings.init({ agentDir, cwd });
		await first.flush();
		const values = snapshot(first);
		expect(await Bun.file(path.join(agentDir, "config.yml")).text()).toBe(yaml);
		expect(await Bun.file(path.join(agentDir, "settings.toml")).exists()).toBe(false);
		resetSettingsForTest();
		await Bun.write(path.join(agentDir, "settings.toml"), "# intentionally empty\n");
		const empty = await Settings.init({ agentDir, cwd });
		expect(snapshot(empty)).toBe(values);
		await empty.flush();
		expect(await Bun.file(path.join(agentDir, "config.yml")).text()).toBe(yaml);
	});
	it("replaces whole top-level objects and arrays while absent keys retain YAML", async () => {
		await Bun.write(
			path.join(agentDir, "settings.toml"),
			'[compaction]\nenabled = true\n[modelRoles]\ndefault = "example/toml"\n',
		);
		const loaded = await Settings.loadReadOnly({ agentDir, cwd });
		expect(loaded.getGlobalSettings()).toEqual({
			compaction: { enabled: true },
			modelRoles: { default: "example/toml" },
		});
		expect(
			overlaySettingsToml(
				{ keep: 1, list: [1, 2], obj: { a: 1, b: 2 } },
				{ list: [], obj: { a: 3 }, keep: undefined },
			),
		).toEqual({ keep: 1, list: [], obj: { a: 3 } });
		expect(await Bun.file(path.join(agentDir, "config.yml")).text()).toBe(yaml);
	});
	it("applies project TOML at project precedence and leaves explicit config/runtime precedence intact", async () => {
		await Bun.write(path.join(cwd, ".omp/config.yml"), "compaction:\n  enabled: false\n  reserveTokens: 2222\n");
		await Bun.write(path.join(cwd, ".omp/settings.toml"), "[compaction]\nenabled = true\n");
		const loaded = await Settings.loadReadOnly({ agentDir, cwd, overrides: { "compaction.enabled": false } });
		expect(loaded.getProjectSettings().compaction).toEqual({ enabled: true });
		expect(snapshot(loaded)).toContain('["compaction.enabled",false]');
	});
	it("rejects malformed TOML and allows singleton initialization to recover", async () => {
		await Bun.write(path.join(agentDir, "settings.toml"), "broken = [");
		await expect(Settings.init({ agentDir, cwd })).rejects.toThrow("settings.toml");
		await Bun.write(path.join(agentDir, "settings.toml"), "");
		expect(await Settings.init({ agentDir, cwd })).toBeInstanceOf(Settings);
	});
	it("rejects malformed project TOML rather than silently falling back", async () => {
		await Bun.write(path.join(cwd, ".omp/settings.toml"), "broken = [");
		await expect(Settings.loadReadOnly({ agentDir, cwd })).rejects.toThrow("settings.toml");
	});
	it("saves to legacy TOML and reloads or removes overlays atomically", async () => {
		const tomlPath = path.join(agentDir, "settings.toml");
		await Bun.write(tomlPath, "[compaction]\nenabled = true\n");
		const loaded = await Settings.init({ agentDir, cwd });
		expect(cfgCompactionEnabled.get(loaded)).toBe(true);
		cfgCompactionEnabled.set(loaded, false);
		await loaded.flush();
		expect(cfgCompactionEnabled.get(loaded)).toBe(false);
		expect(Bun.TOML.parse(await Bun.file(tomlPath).text())).toEqual({ compaction: { enabled: false } });
		expect(await Bun.file(path.join(agentDir, "config.yml")).text()).toBe(yaml);
		await Bun.write(tomlPath, "broken = [");
		await expect(loaded.reloadFromDisk()).rejects.toThrow("settings.toml");
		expect(cfgCompactionEnabled.get(loaded)).toBe(false);
		await fs.rm(tomlPath);
		await loaded.reloadFromDisk();
		expect(cfgCompactionEnabled.get(loaded)).toBe(false);
	});
	it("dumps every registered default deterministically as valid TOML without reading user settings", async () => {
		const text = dumpSettingsToml();
		const parsed = Bun.TOML.parse(text);
		expect(dumpSettingsToml()).toBe(text);
		for (const setting of orderedSettings()) {
			expect(text).toContain(`# ${setting.id} (${setting.type})`);
			if (setting.default === undefined || setting.default === null) continue;
			let actual: unknown = parsed;
			for (const segment of setting.segments) actual = (actual as Record<string, unknown>)[segment];
			expect(actual).toEqual(setting.default);
		}
		await Bun.write(path.join(agentDir, "settings.toml"), text);
		expect(await Settings.loadReadOnly({ agentDir, cwd })).toBeInstanceOf(Settings);
		expect(parseConfigArgs(["config", "dump-toml"])?.action).toBe("dump-toml");
	});
});
