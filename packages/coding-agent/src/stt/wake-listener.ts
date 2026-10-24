import { logger } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import { createStreamingPlayer, type StreamingAudioPlayer } from "../tts/streaming-player";
import { vocalizer } from "../tts/vocalizer";
import { sttClient } from "./asr-client";
import { downloadSttModel } from "./downloader";
import { acquireMicrophoneLease, type MicrophoneLease } from "./microphone-lease";
import { DEFAULT_STT_MODEL_KEY } from "./models";
import {
	cfgWakeCancelMs,
	cfgWakeChirpPath,
	cfgWakeContinueChirpPath,
	cfgWakeEndChirpPath,
	cfgWakeEnabled,
	cfgWakeEndWord,
	cfgWakeSilenceMs,
	cfgWakePlaybackTailMs,
	cfgWakeSuppressWhileSpeaking,
} from "./settings";
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
	/** Test seam for a listener without claiming another session's microphone. */
	acquireLease?: typeof acquireMicrophoneLease;
	detector?: KeywordDetector;
	prepare?: (signal: AbortSignal) => Promise<void>;
	/** Runs on activation before the readiness chirp. */
	activated?: () => void;
	isSpeechPlaying?: () => boolean;
	/** Called after a microphone error, allowing the owner to leave voice mode. */
	stopped?: () => void;
}

/** Owns microphone, detector cancellation and speaker lifetime for one enabled session. */
export class WakeListener {
	#abort: AbortController | undefined;
	#capture: { stop(): void } | undefined;
	#recorder: WakeRecorder | undefined;
	#player: StreamingAudioPlayer | undefined;
	#lease: MicrophoneLease | undefined;

	constructor(readonly deps: WakeListenerDependencies) {}

	async start(): Promise<boolean> {
		if (!cfgWakeEnabled.get(this.deps.settings) || this.#abort) return false;
		const abort = new AbortController();
		this.#abort = abort;
		try {
			this.#lease = (this.deps.acquireLease ?? acquireMicrophoneLease)();
			await (this.deps.prepare?.(abort.signal) ??
				downloadSttModel(DEFAULT_STT_MODEL_KEY, undefined, { signal: abort.signal }));
			if (abort.signal.aborted) return false;
			const loadChirp = async (path: string) => {
				if (!path) return undefined;
				const sound = decodePcm16Wav(new Uint8Array(await Bun.file(path).arrayBuffer()));
				if (sound.samples.length / sound.sampleRate > 2) throw new Error("Wake chirp must be at most two seconds");
				return sound;
			};
			let chirp = await loadChirp(cfgWakeChirpPath.get(this.deps.settings).trim());
			if (!chirp) {
				const samples = new Float32Array(1600);
				for (let i = 0; i < samples.length; i++)
					samples[i] = 0.1 * Math.sin((2 * Math.PI * 880 * i) / 16000) * Math.sin((Math.PI * i) / samples.length);
				chirp = { samples, sampleRate: 16000 };
			}
			if (abort.signal.aborted) return false;
			const continueChirp = await loadChirp(cfgWakeContinueChirpPath.get(this.deps.settings).trim());
			const endChirp = await loadChirp(cfgWakeEndChirpPath.get(this.deps.settings).trim());
			if (abort.signal.aborted) return false;
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
					playbackTailMs: bounded(cfgWakePlaybackTailMs.get(this.deps.settings), 0, 3000, 300),
				},
				{
					chirp: async () => {
						this.deps.activated?.();
						vocalizer.interruptTurn();
						this.deps.status("Wake word heard; recording request");
						await this.#playChirp(chirp, abort.signal);
					},
					cancel: () => this.deps.status("Wake activation cancelled; listening for computer"),
					error: error => this.#warn(error),
					submit: async audio => {
						void this.#playChirp(continueChirp, abort.signal);
						const transcript = await this.deps.controller.transcribeRecording(audio, abort.signal);
						if (abort.signal.aborted) return;
						void this.#playChirp(endChirp, abort.signal);
						const text = stripWakeWords(transcript, endWord);
						if (text) await this.deps.submit(text);
					},
				},
			);
			this.#recorder = recorder;
			this.#capture = (this.deps.capture ?? sharedAudioCapture)(16000, (error, samples) => {
				if (abort.signal.aborted) return;
				if (error) {
					this.#warn(error);
					this.stop();
				} else if (!this.#player) {
					const suppress = cfgWakeSuppressWhileSpeaking.get(this.deps.settings);
					recorder.push(samples, suppress && (this.deps.isSpeechPlaying?.() ?? vocalizer.isSpeaking()));
				}
			});
			this.deps.status("Listening for computer");
			return true;
		} catch (error) {
			if (!abort.signal.aborted) {
				this.#warn(error);
				this.stop();
			}
		}
		return false;
	}

	async #playChirp(
		chirp: { samples: Float32Array; sampleRate: number } | undefined,
		signal: AbortSignal,
	): Promise<void> {
		if (!chirp || signal.aborted) return;
		this.#player?.stop();
		const player = createStreamingPlayer();
		this.#player = player;
		try {
			player.start(chirp.sampleRate);
			player.write(chirp.samples);
			await player.end();
		} catch (error) {
			if (!signal.aborted && this.#player === player) this.#warn(error);
		} finally {
			player.stop();
			if (this.#player === player) this.#player = undefined;
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
		this.#lease?.release();
		this.#lease = undefined;
		this.deps.stopped?.();
	}
}
