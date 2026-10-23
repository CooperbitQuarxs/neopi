import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings, settings } from "../src/config/settings";
import { FloatRing } from "../src/stt/endpointer";
import { cfgWakeEnabled } from "../src/stt/settings";
import { STTController } from "../src/stt/stt-controller";
import { stripWakeWords, WakeListener } from "../src/stt/wake-listener";
import { type KeywordDetector, speechBandAccepts, WakeRecorder } from "../src/stt/wake-recorder";
import { decodePcm16Wav, encodePcm16Wav } from "../src/stt/wav";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

// Generated with espeak-ng -v en-us -s 145, resampled to 16 kHz PCM16 with ffmpeg.
const fixture = async (name: string) =>
	decodePcm16Wav(new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/wake-word/${name}.wav`).arrayBuffer()))
		.samples;
const silence = (ms: number) => new Float32Array(ms * 16);
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
const match = { matched: true, trailingSpeech: false };
function setup(detector: KeywordDetector = { detect: async () => match }, silenceMs = 2000, endWord = "") {
	const callbacks = {
		chirp: vi.fn(),
		submit: vi.fn(async (_audio: Float32Array) => {}),
		cancel: vi.fn(),
		error: vi.fn(),
	};
	const recorder = new WakeRecorder(detector, { silenceMs, cancelMs: 3000, endWord }, callbacks);
	return { recorder, ...callbacks };
}
async function activate(recorder: WakeRecorder) {
	const audio = await fixture("computer");
	recorder.push(audio);
	// Align the sample clock before asserting exact frame-boundary deadlines.
	recorder.push(new Float32Array((320 - (audio.length % 320)) % 320));
	recorder.push(silence(1000));
	await settle();
}

describe("wake recorder", () => {
	it("gates silence before decoding and rejects low-frequency rumble", async () => {
		const detect = vi.fn(async () => match);
		const { recorder, chirp } = setup({ detect });
		recorder.push(silence(10000));
		const rumble = Float32Array.from({ length: 32000 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 50 * i) / 16000));
		expect(speechBandAccepts(rumble)).toBe(false);
		recorder.push(rumble);
		await settle();
		expect(detect).not.toHaveBeenCalled();
		expect(chirp).not.toHaveBeenCalled();
		recorder.dispose();
	});

	it("passes a speech fixture to the keyword detector but does not trigger other speech", async () => {
		const detect = vi.fn(async (_audio: Float32Array, _word: string, _signal: AbortSignal) => ({
			matched: false,
			trailingSpeech: false,
		}));
		const { recorder, chirp } = setup({ detect });
		recorder.push(await fixture("request"));
		await settle();
		expect(detect).toHaveBeenCalledTimes(1);
		expect(detect.mock.calls[0]?.[1]).toBe("computer");
		expect(chirp).not.toHaveBeenCalled();
		recorder.dispose();
	});

	it("cancels flat audio at the configured misactivation timeout without submitting", async () => {
		const { recorder, chirp, cancel, submit } = setup();
		await activate(recorder);
		expect(chirp).toHaveBeenCalledTimes(1);
		recorder.push(silence(2980));
		expect(cancel).not.toHaveBeenCalled();
		recorder.push(silence(20));
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(submit).not.toHaveBeenCalled();
		recorder.dispose();
	});

	it.each([400, 2000, 3000])("ends once after %i ms of silence", async silenceMs => {
		const { recorder, submit } = setup(undefined, silenceMs);
		await activate(recorder);
		const voiced = Float32Array.from({ length: 320 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 16000));
		recorder.push(voiced);
		recorder.push(silence(silenceMs - 20));
		expect(submit).not.toHaveBeenCalled();
		recorder.push(silence(20));
		await settle();
		expect(submit).toHaveBeenCalledTimes(1);
		recorder.push(silence(10000));
		await settle();
		expect(submit).toHaveBeenCalledTimes(1);
		recorder.dispose();
	});

	it("preserves the first request word across a detector slower than the pre-roll window", async () => {
		const pending = Promise.withResolvers<{ matched: boolean; trailingSpeech: boolean }>();
		const { recorder, submit } = setup({ detect: () => pending.promise });
		recorder.push(await fixture("computer"));
		recorder.push(silence(1000));
		const request = await fixture("request");
		recorder.push(request);
		recorder.push(silence(6000));
		pending.resolve(match);
		await settle();
		recorder.push(silence(2000));
		await settle();
		expect(submit).toHaveBeenCalledTimes(1);
		const audio = submit.mock.calls[0]![0];
		// Exact waveform of the first word survives, not just a marker or transcript.
		const start = (await fixture("computer")).length + 16000;
		expect(Array.from(audio.subarray(start, start + request.length))).toEqual(Array.from(request));
		recorder.dispose();
	});

	it("stops on an optional end word and does not reuse the wake word window", async () => {
		const detect = vi.fn(async () => match);
		const { recorder, submit } = setup({ detect }, 2000, "computer");
		await activate(recorder);
		await activate(recorder);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(detect).toHaveBeenCalledTimes(2);
		recorder.dispose();
	});

	it("does not chirp or submit after disposal during detection", async () => {
		const pending = Promise.withResolvers<{ matched: boolean; trailingSpeech: boolean }>();
		const { recorder, chirp, submit } = setup({ detect: () => pending.promise });
		await activate(recorder);
		recorder.dispose();
		pending.resolve(match);
		await settle();
		expect(chirp).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it("retains ordered samples after 72 hours of 20 ms ring writes", () => {
		const ring = new FloatRing(64000);
		const frame = new Float32Array(320);
		const count = 72 * 60 * 60 * 50;
		for (let i = 0; i < count; i++) {
			frame.fill(i);
			ring.push(frame);
		}
		const audio = ring.snapshot();
		expect(audio.length).toBe(64000);
		for (let i = 0; i < 200; i++) {
			expect(audio[i * 320]).toBe(count - 200 + i);
			expect(audio[(i + 1) * 320 - 1]).toBe(count - 200 + i);
		}
	});

	it("strips activation and optional end word without eating ordinary request words", () => {
		expect(stripWakeWords("Computer, show my files. Finish!", "finish")).toBe("show my files.");
		expect(stripWakeWords("Computer, tell me about computers", "")).toBe("tell me about computers");
	});

	it("decodes custom PCM16 chirps and rejects truncated chunks", () => {
		const wav = encodePcm16Wav([new Float32Array([0.5, -0.5])], 24000);
		expect(decodePcm16Wav(wav).sampleRate).toBe(24000);
		expect(decodePcm16Wav(wav).samples[1]).toBe(-0.5);
		expect(() => decodePcm16Wav(wav.subarray(0, wav.length - 1))).toThrow("Truncated");
	});
});

describe("wake microphone ownership", () => {
	let state: SettingsTestState | undefined;
	beforeEach(async () => {
		state = beginSettingsTest();
		await Settings.init({ inMemory: true });
	});
	afterEach(() => {
		restoreSettingsTestState(state);
		vi.restoreAllMocks();
	});

	it("never prepares a model or opens the mic when disabled", async () => {
		const capture = vi.fn(() => ({ stop() {} }));
		const prepare = vi.fn(async () => {});
		const listener = new WakeListener({
			settings,
			controller: new STTController(),
			capture,
			prepare,
			submit: async () => {},
			status: () => {},
			warning: () => {},
		});
		await listener.start();
		expect(capture).not.toHaveBeenCalled();
		expect(prepare).not.toHaveBeenCalled();
		listener.stop();
	});

	it("disabling while a model loads cannot reopen the microphone", async () => {
		cfgWakeEnabled.set(settings, true);
		const loading = Promise.withResolvers<void>();
		const capture = vi.fn(() => ({ stop() {} }));
		const listener = new WakeListener({
			settings,
			controller: new STTController(),
			capture,
			prepare: () => loading.promise,
			submit: async () => {},
			status: () => {},
			warning: () => {},
		});
		const starting = listener.start();
		listener.stop();
		loading.resolve();
		await starting;
		expect(capture).not.toHaveBeenCalled();
	});

	it("stops its microphone when switched off", async () => {
		cfgWakeEnabled.set(settings, true);
		const stop = vi.fn();
		const capture = vi.fn(() => ({ stop }));
		const listener = new WakeListener({
			settings,
			controller: new STTController(),
			capture,
			prepare: async () => {},
			submit: async () => {},
			status: () => {},
			warning: () => {},
		});
		await listener.start();
		listener.stop();
		expect(capture).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
	});
});
