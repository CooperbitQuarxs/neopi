import { afterEach, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { buildLiveSessionPayload } from "../../src/live/protocol";
import { cfgLiveModel } from "../../src/live/settings";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "../helpers/settings-test-state";

let root: string | undefined;
let state: SettingsTestState | undefined;

afterEach(async () => {
	restoreSettingsTestState(state);
	if (root) await fs.rm(root, { recursive: true, force: true });
});

it("round-trips live.model through config YAML and builds the configured session", async () => {
	state = beginSettingsTest();
	const cacheDir = path.join(process.env.HOME!, ".cache/npi-canary");
	await fs.mkdir(cacheDir, { recursive: true });
	root = await fs.mkdtemp(path.join(cacheDir, "live-model-test-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	await fs.mkdir(cwd);
	await Bun.write(path.join(agentDir, "config.yml"), "setupVersion: 999999\n");
	const settings = await Settings.init({ cwd, agentDir });
	expect(cfgLiveModel.get(settings)).toBe("gpt-live-1-codex");
	cfgLiveModel.set(settings, "custom-live-model");
	await settings.flush();
	const loaded = await Settings.loadReadOnly({ cwd, agentDir });
	expect(cfgLiveModel.get(loaded)).toBe("custom-live-model");
	expect(buildLiveSessionPayload("", "sol", cfgLiveModel.get(loaded)).model).toBe("custom-live-model");
});
