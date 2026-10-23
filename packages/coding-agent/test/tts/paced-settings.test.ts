import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Settings, resetSettingsForTest } from "../../src/config/settings";
import {
	cfgSpeechEnabled,
	cfgSpeechMode,
	cfgTtsPacing,
	speechPacingThreads,
	speechSegmentOptions,
} from "../../src/tts/settings";
import { TTS_LOCAL_MODELS } from "../../src/tts/models";
let directory: string | undefined;
afterEach(async () => {
	resetSettingsForTest();
	if (directory) await fs.rm(directory, { recursive: true, force: true });
	directory = undefined;
});
test("fresh settings keep speech and thinking off, and preserve the original default engine", async () => {
	const root = path.join(process.env.HOME!, ".cache/npi-canary");
	await fs.mkdir(root, { recursive: true });
	directory = await fs.mkdtemp(path.join(root, "paced-settings-"));
	const settings = await Settings.init({ cwd: directory, agentDir: directory, inMemory: true });
	expect(cfgSpeechEnabled.get(settings)).toBe(false);
	expect(cfgSpeechMode.get(settings)).toBe("assistant");
	expect(cfgTtsPacing.get(settings)).toBe(true);
	expect(speechPacingThreads(settings)).toBe(0);
	expect(speechSegmentOptions(settings).firstChars).toBe(80);
	expect(TTS_LOCAL_MODELS[0].key).toBe("kokoro");
	expect(getBundledModel("local", "kokoro-paced")?.kind).toBe("tts");
});
