import { logger } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import { createStreamingPlayer, type StreamingAudioPlayer } from "../tts/streaming-player";
import { sttClient } from "./asr-client";
import { downloadSttModel } from "./downloader";
import { DEFAULT_STT_MODEL_KEY } from "./models";
import { cfgWakeCancelMs, cfgWakeChirpPath, cfgWakeEnabled, cfgWakeEndWord, cfgWakeSilenceMs } from "./settings";
import { sharedAudioCapture } from "./shared-audio-capture";
import type { STTController } from "./stt-controller";
import { decodePcm16Wav } from "./wav";
import { type KeywordDetector, WakeRecorder } from "./wake-recorder";

function words(text: string): string[] {
	return text.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Existing downloader/worker support offline Parakeet, not streaming KWS models. */
export class ParakeetKeywordDetector implements KeywordDetector {
	async detect(
		audio: Float32Array,
		word: string,
		signal: AbortSignal,
	): Promise<{ matched: boolean; trailingSpeech: boolean }> {
		const text = await sttClient.transcribe(DEFAULT_STT_MODEL_KEY, audio, { signal });
		const tokens = words(text);
		const index = tokens.indexOf(word.toLocaleLowerCase("en").trim());
		return { matched: index >= 0, trailingSpeech: index >= 0 && index < tokens.length - 1 };
	}
}

export function stripWakeWords(text: string, endWord: string): string {
	const start = /\bcomputer\b[\s,.:;!?]*/i.exec(text);
	let result = start ? text.slice(start.index + start[0].length) : text;
	const ending = words(endWord);
	if (ending.length === 1) {
		const tokens = [...result.matchAll(/[\p{L}\p{N}]+/gu)];
		const last = tokens.at(-1);
		if (last && last[0].toLocaleLowerCase("en") === ending[0]) result = result.slice(0, last.index);
	}
	return result.trim();
}

export interface WakeListenerDependencies {
	settings: Settings;
	controller: STTController;
	submit(text: string): Promise<void>;
	status(text: string): void;
	warning(text: string): void;
	/** Hardware seam: disabled listeners must never call this. */
	capture?: typeof sharedAudioCapture;
	detector?: KeywordDetector;
	prepare?: (signal: AbortSignal) => Promise<void>;
}

/** Owns microphone, detector cancellation and speaker lifetime for one enabled session. */
export class WakeListener {
	#abort: AbortController | undefined;
	#capture: { stop(): void } | undefined;
	#recorder: WakeRecorder | undefined;
	#player: StreamingAudioPlayer | undefined;

	constructor(readonly deps: WakeListenerDependencies) {}

	async start(): Promise<void> {
		if (!cfgWakeEnabled.get(this.deps.settings) || this.#abort) return;
		const abort = new AbortController();
		this.#abort = abort;
		try {
			await (this.deps.prepare?.(abort.signal) ??
				downloadSttModel(DEFAULT_STT_MODEL_KEY, undefined, { signal: abort.signal }));
			if (abort.signal.aborted) return;
			const soundPath = cfgWakeChirpPath.get(this.deps.settings).trim();
			let chirp: { samples: Float32Array; sampleRate: number };
			if (soundPath) {
				chirp = decodePcm16Wav(new Uint8Array(await Bun.file(soundPath).arrayBuffer()));
				if (chirp.samples.length / chirp.sampleRate > 2) throw new Error("Wake chirp must be at most two seconds");
			} else {
				const samples = new Float32Array(1600);
				for (let i = 0; i < samples.length; i++)
					samples[i] = 0.1 * Math.sin((2 * Math.PI * 880 * i) / 16000) * Math.sin((Math.PI * i) / samples.length);
				chirp = { samples, sampleRate: 16000 };
			}
			if (abort.signal.aborted) return;
			const endWord = cfgWakeEndWord.get(this.deps.settings).trim();
			if (endWord && words(endWord).length !== 1) throw new Error("Wake end word must be one word");
			const bounded = (value: number, min: number, max: number, fallback: number) =>
				Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
			const recorder = new WakeRecorder(
				this.deps.detector ?? new ParakeetKeywordDetector(),
				{
					silenceMs: bounded(cfgWakeSilenceMs.get(this.deps.settings), 200, 30000, 2000),
					cancelMs: bounded(cfgWakeCancelMs.get(this.deps.settings), 2000, 5000, 3000),
					endWord,
				},
				{
					chirp: () => {
						this.deps.status("Wake word heard; recording request");
						this.#player?.stop();
						const player = createStreamingPlayer();
						this.#player = player;
						try {
							player.start(chirp.sampleRate);
							player.write(chirp.samples);
							void player.end().catch(error => this.#warn(error));
						} catch (error) {
							this.#warn(error);
						}
					},
					cancel: () => this.deps.status("Wake activation cancelled; listening for computer"),
					error: error => this.#warn(error),
					submit: async audio => {
						const text = stripWakeWords(
							await this.deps.controller.transcribeRecording(audio, abort.signal),
							endWord,
						);
						if (!abort.signal.aborted && text) await this.deps.submit(text);
					},
				},
			);
			this.#recorder = recorder;
			this.#capture = (this.deps.capture ?? sharedAudioCapture)(16000, (error, samples) => {
				if (abort.signal.aborted) return;
				if (error) {
					this.#warn(error);
					this.stop();
				} else recorder.push(samples);
			});
			this.deps.status("Listening for computer");
		} catch (error) {
			if (!abort.signal.aborted) {
				this.#warn(error);
				this.stop();
			}
		}
	}

	#warn(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn("Wake listener failed", { error: message });
		this.deps.warning(message);
	}

	stop(): void {
		this.#abort?.abort();
		this.#abort = undefined;
		this.#recorder?.dispose();
		this.#recorder = undefined;
		this.#player?.stop();
		this.#player = undefined;
		this.#capture?.stop();
		this.#capture = undefined;
	}
}
