import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setAgentDir } from "@oh-my-pi/pi-utils";
import { Settings, settings } from "../src/config/settings";
import { XaiSTTController, type XaiSTTControllerDependencies } from "../src/stt/xai-stt-controller";
import { WavFileRecorder } from "../src/stt/wav-file-recorder";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";
import { cfgSttEnabled } from "@oh-my-pi/pi-coding-agent/stt/settings";
import { cfgSttSubmitTrigger } from "@oh-my-pi/pi-coding-agent/stt/settings";

describe("independent xAI whole-recording input", () => {
	let savedSettings: SettingsTestState | undefined;
	let tmp = "";
	let controller: XaiSTTController | undefined;
	let onAudio: ((error: Error | null, samples: Float32Array) => void) | undefined;

	beforeEach(async () => {
		savedSettings = beginSettingsTest();
		await Settings.init({ inMemory: true });
		cfgSttEnabled.set(settings, false);
		cfgSttSubmitTrigger.set(settings, "never");
		settings.setModelRole("dictation", "local-inference/parakeet-tdt-0.6b-v3");
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "neopi-xai-recording-"));
		setAgentDir(tmp);
		onAudio = undefined;
	});

	afterEach(async () => {
		controller?.dispose();
		controller = undefined;
		restoreSettingsTestState(savedSettings);
		vi.restoreAllMocks();
		await fs.rm(tmp, { recursive: true, force: true });
	});

	function setup(
		transcribe: XaiSTTControllerDependencies["transcribe"],
		createCapture?: XaiSTTControllerDependencies["createCapture"],
	) {
		let text = "Existing draft. ";
		const editor = {
			get text() {
				return text;
			},
			insertText(chunk: string) {
				text += chunk;
			},
			submit: vi.fn(),
		};
		const options = { showWarning: vi.fn(), showStatus: vi.fn(), onStateChange: vi.fn() };
		const stopCapture = vi.fn();
		controller = new XaiSTTController({
			settings,
			transcribe,
			createCapture(callback) {
				onAudio = callback;
				return createCapture ? createCapture(callback) : { stop: stopCapture };
			},
		});
		return { editor, options, controller, stopCapture };
	}

	it("keeps speech and long pauses in one WAV until the second toggle, regardless of configured dictation", async () => {
		let recording: ArrayBuffer | undefined;
		const transcribe = vi.fn(async (audio: Blob) => {
			recording = await audio.arrayBuffer();
			return "One complete thought.";
		});
		const { editor, options, controller } = setup(transcribe);
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25, -0.25]));
		const pause = new Float32Array(16_000 * 5);
		onAudio!(null, pause);
		onAudio!(null, new Float32Array([0.5]));

		expect(controller.state).toBe("recording");
		expect(transcribe).not.toHaveBeenCalled();
		expect(editor.text).toBe("Existing draft. ");
		await controller.toggle(editor, options);

		expect(transcribe).toHaveBeenCalledTimes(1);
		const wav = new DataView(recording!);
		const trailingSamples = 12_000; // 750 ms at 16 kHz
		expect(wav.byteLength).toBe(44 + (pause.length + 3 + trailingSamples) * 2);
		expect(wav.getUint32(40, true)).toBe((pause.length + 3 + trailingSamples) * 2);
		expect(wav.getInt16(44, true)).toBe(8192);
		expect(wav.getInt16(46, true)).toBe(-8192);
		expect(new Int16Array(recording!, 48, pause.length).every(sample => sample === 0)).toBe(true);
		expect(wav.getInt16(48 + pause.length * 2, true)).toBe(16384);
		expect(new Int16Array(recording!, 50 + pause.length * 2, trailingSamples).every(sample => sample === 0)).toBe(
			true,
		);
		expect(editor.text).toBe("Existing draft. One complete thought.");
		expect(editor.submit).not.toHaveBeenCalled();
		expect(controller.state).toBe("idle");
	});

	it("finishes an empty capture without transcription or editor submission", async () => {
		const transcribe = vi.fn(async () => "must not be requested");
		const { editor, options, controller } = setup(transcribe);
		await controller.toggle(editor, options);
		await controller.toggle(editor, options);
		expect(transcribe).not.toHaveBeenCalled();
		expect(controller.state).toBe("idle");
		expect(editor.text).toBe("Existing draft. ");
		expect(editor.submit).not.toHaveBeenCalled();
	});

	it("returns to idle without inserting or submitting when xAI detects no speech", async () => {
		const transcribe = vi.fn(async () => "");
		const { editor, options, controller } = setup(transcribe);
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array(16_000));
		await controller.toggle(editor, options);
		expect(transcribe).toHaveBeenCalledTimes(1);
		expect(controller.state).toBe("idle");
		expect(editor.text).toBe("Existing draft. ");
		expect(editor.submit).not.toHaveBeenCalled();
		expect(options.showWarning).not.toHaveBeenCalled();
	});

	it("keeps the original WAV available for transcription when padding fails", async () => {
		vi.spyOn(WavFileRecorder.prototype, "appendSilence").mockImplementation(() => {
			throw new Error("No space for padding");
		});
		let recording: ArrayBuffer | undefined;
		const { editor, options, controller } = setup(async audio => {
			recording = await audio.arrayBuffer();
			return "Final word.";
		});
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.5]));
		await controller.toggle(editor, options);

		const wav = new DataView(recording!);
		expect(wav.byteLength).toBe(46);
		expect(wav.getUint32(40, true)).toBe(2);
		expect(wav.getInt16(44, true)).toBe(16384);
		expect(editor.text).toBe("Existing draft. Final word.");
		expect(options.showWarning).not.toHaveBeenCalled();
		const files = await fs.readdir(path.join(tmp, "stt-recordings"));
		expect(files).toHaveLength(1);
		expect(controller.state).toBe("idle");
	});

	it("preserves the complete audio and reports its recovery path after a provider failure", async () => {
		const { editor, options, controller } = setup(async () => {
			throw new Error("Provider unavailable");
		});
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.5]));
		await controller.toggle(editor, options);
		const recordingDir = path.join(tmp, "stt-recordings");
		const files = await fs.readdir(recordingDir);
		expect(files).toHaveLength(1);
		const retainedPath = path.join(recordingDir, files[0]!);
		const retained = new DataView(await Bun.file(retainedPath).arrayBuffer());
		expect(retained.getInt16(44, true)).toBe(16384);
		expect(options.showWarning).toHaveBeenCalledWith(expect.stringContaining(retainedPath));
		expect(editor.text).toBe("Existing draft. ");
		expect(controller.state).toBe("idle");
	});

	it("routes overlapping transcripts to their own destinations without retiring newer capture", async () => {
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		const requests: { audio: Blob; signal: AbortSignal }[] = [];
		const { editor, options, controller } = setup((audio, signal) => {
			requests.push({ audio, signal });
			return requests.length === 1 ? first.promise : second.promise;
		});
		const nextEditor = { insertText: vi.fn(), submit: vi.fn() };
		const nextOptions = { showWarning: vi.fn(), showStatus: vi.fn(), onStateChange: vi.fn() };
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25]));
		const firstStop = controller.toggle(editor, options);
		await controller.toggle(nextEditor, nextOptions);
		expect(controller.state).toBe("recording");
		onAudio!(null, new Float32Array([0.5]));
		const secondStop = controller.toggle(nextEditor, nextOptions);
		expect(requests).toHaveLength(2);
		await controller.toggle(nextEditor, nextOptions);
		expect(controller.state).toBe("recording");
		const stateChanges = nextOptions.onStateChange.mock.calls.length;
		second.resolve("Second thought.");
		await secondStop;
		expect(nextEditor.insertText).toHaveBeenCalledWith("Second thought.");
		expect(editor.text).toBe("Existing draft. ");
		expect(controller.state).toBe("recording");
		expect(nextOptions.onStateChange).toHaveBeenCalledTimes(stateChanges);
		first.resolve("First thought.");
		await firstStop;
		expect(editor.text).toBe("Existing draft. First thought.");
		expect(controller.state).toBe("recording");
		expect(requests.every(request => !request.signal.aborted)).toBe(true);
		const firstWav = new DataView(await requests[0]!.audio.arrayBuffer());
		const secondWav = new DataView(await requests[1]!.audio.arrayBuffer());
		expect(firstWav.getInt16(44, true)).toBe(8192);
		expect(secondWav.getInt16(44, true)).toBe(16384);
	});

	it("keeps a newer microphone alive after an older provider failure", async () => {
		const pending = Promise.withResolvers<string>();
		const { editor, options, controller, stopCapture } = setup(() => pending.promise);
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25]));
		const stopped = controller.toggle(editor, options);
		await controller.toggle(editor, options);
		expect(controller.state).toBe("recording");
		pending.reject(new Error("Older request failed"));
		await stopped;
		expect(controller.state).toBe("recording");
		expect(stopCapture).toHaveBeenCalledTimes(1);
		expect(options.showWarning).toHaveBeenCalledWith(expect.stringContaining("Older request failed"));
		onAudio!(null, new Float32Array([0.5]));
		onAudio!(new Error("New microphone failed"), new Float32Array());
		expect(stopCapture).toHaveBeenCalledTimes(2);
		expect(controller.state).toBe("idle");
		const files = await fs.readdir(path.join(tmp, "stt-recordings"));
		expect(files).toHaveLength(2);
	});

	it("aborts every pending request and active capture on disposal without late insertion", async () => {
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		const signals: AbortSignal[] = [];
		const { editor, options, controller, stopCapture } = setup((_audio, signal) => {
			signals.push(signal);
			return signals.length === 1 ? first.promise : second.promise;
		});
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25]));
		const firstStop = controller.toggle(editor, options);
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.5]));
		const secondStop = controller.toggle(editor, options);
		expect(signals).toHaveLength(2);
		await controller.toggle(editor, options);
		const stateChanges = options.onStateChange.mock.calls.length;
		controller.dispose();
		expect(signals.every(signal => signal.aborted)).toBe(true);
		expect(stopCapture).toHaveBeenCalledTimes(3);
		first.resolve("Never insert this.");
		second.reject(new Error("Disposed provider"));
		await Promise.all([firstStop, secondStop]);
		await controller.toggle(editor, options);
		expect(controller.state).toBe("idle");
		expect(editor.text).toBe("Existing draft. ");
		expect(editor.submit).not.toHaveBeenCalled();
		expect(options.showWarning).not.toHaveBeenCalled();
		expect(options.onStateChange).toHaveBeenCalledTimes(stateChanges);
		expect(await fs.readdir(path.join(tmp, "stt-recordings"))).toHaveLength(0);
	});

	it("clears pending state after an older request settles following a failed newer capture", async () => {
		const pending = Promise.withResolvers<string>();
		const createCapture = vi
			.fn()
			.mockImplementationOnce(() => ({ stop() {} }))
			.mockImplementationOnce(() => {
				throw new Error("Microphone unavailable");
			});
		const { editor, options, controller } = setup(() => pending.promise, createCapture);
		const newerOptions = { showWarning: vi.fn(), showStatus: vi.fn(), onStateChange: vi.fn() };
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25]));
		const stopped = controller.toggle(editor, options);
		await controller.toggle(editor, newerOptions);
		expect(newerOptions.showWarning).toHaveBeenCalledWith("Microphone unavailable");
		expect(controller.state).toBe("transcribing");
		const olderStateChanges = options.onStateChange.mock.calls.length;
		pending.resolve("Original speech.");
		await stopped;
		expect(editor.text).toBe("Existing draft. Original speech.");
		expect(controller.state).toBe("idle");
		expect(newerOptions.onStateChange).toHaveBeenLastCalledWith("idle");
		expect(options.onStateChange).toHaveBeenCalledTimes(olderStateChanges);
	});

	it("remains transcribing when the newest request finishes before an older request", async () => {
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		let requests = 0;
		const { editor, options, controller } = setup(() => (++requests === 1 ? first.promise : second.promise));
		const newerOptions = { showWarning: vi.fn(), showStatus: vi.fn(), onStateChange: vi.fn() };
		await controller.toggle(editor, options);
		onAudio!(null, new Float32Array([0.25]));
		const firstStop = controller.toggle(editor, options);
		await controller.toggle(editor, newerOptions);
		onAudio!(null, new Float32Array([0.5]));
		const secondStop = controller.toggle(editor, newerOptions);
		const olderStateChanges = options.onStateChange.mock.calls.length;
		second.resolve("Second speech.");
		await secondStop;
		expect(controller.state).toBe("transcribing");
		first.resolve("First speech.");
		await firstStop;
		expect(controller.state).toBe("idle");
		expect(newerOptions.onStateChange).toHaveBeenLastCalledWith("idle");
		expect(options.onStateChange).toHaveBeenCalledTimes(olderStateChanges);
	});
});
