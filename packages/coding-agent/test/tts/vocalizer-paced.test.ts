import { afterEach, expect, spyOn, test, vi } from "bun:test";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AuthStorage } from "../../src/session/auth-storage";
import { ttsClient } from "../../src/tts/tts-client";
import { Vocalizer } from "../../src/tts/vocalizer";
let auth: AuthStorage | undefined;
afterEach(() => {
	vi.restoreAllMocks();
	auth?.close();
	auth = undefined;
});

test("selected paced engine segments and serializes complete utterances into the player", async () => {
	auth = await AuthStorage.create(":memory:");
	const settings = Settings.isolated({
		"speech.enabled": true,
		"tts.pacing": false,
		modelRoles: { speech: "local/kokoro-paced" },
	});
	const registry = new ModelRegistry(auth, undefined, { settings });
	const written: number[] = [];
	let count = 0;
	const synth = spyOn(ttsClient, "synthesize").mockImplementation(async () => ({
		pcm: new Float32Array([++count]),
		sampleRate: 24000,
	}));
	const old = spyOn(ttsClient, "synthesizeStream");
	const vocalizer = new Vocalizer(() => ({
		start() {},
		write(pcm) {
			written.push(pcm[0]!);
		},
		setGain() {},
		async end() {},
		stop() {},
	}));
	vocalizer.setModelSource({ settings, registry });
	vocalizer.speak("The ship is ready. ".repeat(30));
	vocalizer.speak("The crew is waiting. ".repeat(30));
	await vocalizer.idle();
	expect(old).not.toHaveBeenCalled();
	expect(synth.mock.calls.length).toBeGreaterThan(2);
	expect(synth.mock.calls.every(call => call[0] === "kokoro-paced" && call[1].length <= 240)).toBe(true);
	expect(written).toEqual(Array.from({ length: count }, (_, i) => i + 1));
	expect(vocalizer.isSpeaking()).toBe(false);
});

test("original Kokoro retains the existing streaming worker path", async () => {
	auth = await AuthStorage.create(":memory:");
	const settings = Settings.isolated({ "speech.enabled": true, modelRoles: { speech: "local/kokoro" } });
	const registry = new ModelRegistry(auth, undefined, { settings });
	const synth = spyOn(ttsClient, "synthesize");
	const pushed: string[] = [];
	const old = spyOn(ttsClient, "synthesizeStream").mockImplementation(() => ({
		push(text) {
			pushed.push(text);
		},
		end() {},
		chunks: (async function* () {})(),
	}));
	const vocalizer = new Vocalizer(() => ({ start() {}, write() {}, setGain() {}, async end() {}, stop() {} }));
	vocalizer.setModelSource({ settings, registry });
	vocalizer.speak("The ship is ready. The crew is waiting.");
	await vocalizer.idle();
	expect(old).toHaveBeenCalledTimes(1);
	expect(synth).not.toHaveBeenCalled();
	expect(pushed).toEqual(["The ship is ready.", "The crew is waiting."]);
});
