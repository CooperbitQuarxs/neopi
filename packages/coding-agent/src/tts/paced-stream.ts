import { setTimeout as sleep } from "node:timers/promises";
import type { TtsAudio, TtsAudioChunk, TtsStreamHandle } from "./tts-client";

export interface SpeechTimingEstimate {
	synthesisMsPerChar: number;
	audioMsPerChar: number;
}

/** Retained across utterances, not written into portable user settings. */
export const speechTimingEstimate: SpeechTimingEstimate = { synthesisMsPerChar: 8, audioMsPerChar: 65 };

export interface PacingClock {
	now(): number;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
const systemClock: PacingClock = {
	now: () => performance.now(),
	sleep: async (ms, signal) => {
		await sleep(ms, undefined, { signal });
	},
};

/** One utterance's playback horizon. Only the consumer advances it, after writing PCM. */
export class SpeechPacer {
	#bufferedUntil = 0;
	constructor(
		readonly estimate: SpeechTimingEstimate,
		readonly marginMs: number,
		readonly clock: PacingClock = systemClock,
	) {}

	delay(chars: number): number {
		return Math.max(
			0,
			this.#bufferedUntil - this.clock.now() - chars * this.estimate.synthesisMsPerChar - this.marginMs,
		);
	}

	observe(chars: number, synthesisMs: number, audioMs: number): void {
		if (chars <= 0) return;
		// Fast attack protects the next deadline after a slow segment; gradual release avoids jitter.
		const observed = synthesisMs / chars;
		const weight = observed > this.estimate.synthesisMsPerChar ? 0.8 : 0.25;
		this.estimate.synthesisMsPerChar += weight * (observed - this.estimate.synthesisMsPerChar);
		this.estimate.audioMsPerChar += 0.25 * (audioMs / chars - this.estimate.audioMsPerChar);
	}

	buffer(audioMs: number): void {
		this.#bufferedUntil = Math.max(this.clock.now(), this.#bufferedUntil) + audioMs;
	}
}

/** Lazy FIFO: synthesis starts only when playback's consumer requests audio.
 * This also keeps a queued utterance from estimating playback before its player starts.
 */
export function createPacedSpeechStream(options: {
	synthesize(text: string): Promise<TtsAudio | null>;
	pacer: SpeechPacer;
	enabled: boolean;
	signal?: AbortSignal;
}): TtsStreamHandle {
	const queue: string[] = [];
	let ended = false;
	let wake: (() => void) | undefined;
	const signal = options.signal;
	const notify = () => {
		wake?.();
		wake = undefined;
	};
	async function* chunks(): AsyncIterableIterator<TtsAudioChunk> {
		let index = 0;
		signal?.addEventListener("abort", notify, { once: true });
		try {
			while (!signal?.aborted) {
				const text = queue.shift();
				if (text === undefined) {
					if (ended) break;
					const pending = Promise.withResolvers<void>();
					wake = pending.resolve;
					await pending.promise;
					continue;
				}
				if (options.enabled) {
					const delay = options.pacer.delay(text.length);
					if (delay > 0) await options.pacer.clock.sleep(delay, signal);
				}
				if (signal?.aborted) break;
				const started = options.pacer.clock.now();
				const audio = await options.synthesize(text);
				if (signal?.aborted) break;
				if (!audio) throw new Error("Paced local speech synthesis failed");
				const audioMs = (audio.pcm.length / audio.sampleRate) * 1000;
				options.pacer.observe(text.length, options.pacer.clock.now() - started, audioMs);
				yield { ...audio, text, index: index++ };
				// yield resumes after the consumer has queued this PCM for playback.
				options.pacer.buffer(audioMs);
			}
		} catch (error) {
			if (!signal?.aborted) throw error;
		} finally {
			signal?.removeEventListener("abort", notify);
			queue.length = 0;
			ended = true;
		}
	}
	return {
		push(text) {
			if (!ended && !signal?.aborted && text.trim()) {
				queue.push(text);
				notify();
			}
		},
		end() {
			ended = true;
			notify();
		},
		chunks: chunks(),
	};
}
