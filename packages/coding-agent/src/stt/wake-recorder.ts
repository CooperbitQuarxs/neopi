import { FloatBuffer, FloatRing, SpeechLevelGate } from "./endpointer";

export interface KeywordDetector {
	detect(
		audio: Float32Array,
		word: string,
		signal: AbortSignal,
	): Promise<{ matched: boolean; trailingSpeech: boolean }>;
}

export interface WakeRecorderOptions {
	silenceMs: number;
	cancelMs: number;
	endWord: string;
	playbackTailMs: number;
}

/** Spectral energy estimate using a 300–3400 Hz bandpass, after the level gate. */
export function speechBandAccepts(samples: Float32Array): boolean {
	let previous = 0;
	let high = 0;
	let low = 0;
	let total = 0;
	let band = 0;
	const highAlpha = 1 / (1 + (2 * Math.PI * 300) / 16000);
	const lowAlpha = (2 * Math.PI * 3400) / 16000 / (1 + (2 * Math.PI * 3400) / 16000);
	for (const sample of samples) {
		high = highAlpha * (high + sample - previous);
		previous = sample;
		low += lowAlpha * (high - low);
		total += sample * sample;
		band += low * low;
	}
	return total > 0 && band / total >= 0.35;
}

/** Sample-clock state machine. No wall-clock or lifetime-growing ring indexes. */
export class WakeRecorder {
	readonly #ring = new FloatRing(16000 * 4);
	readonly #level = new SpeechLevelGate();
	readonly #abort = new AbortController();
	readonly #frame = new Float32Array(320);
	#filled = 0;
	#cadence = 0;
	#busy = false;
	#submitting = false;
	#gated = false;
	#recording = false;
	#speech = false;
	#generation = 0;
	#elapsed = 0;
	#silence = 0;
	readonly #audio = new FloatBuffer();
	readonly #candidate = new FloatBuffer();
	#pendingSpeech = false;
	#chirping = false;
	#playbackSuppressed = false;
	#tailSamples = 0;

	constructor(
		readonly detector: KeywordDetector,
		readonly options: WakeRecorderOptions,
		readonly callbacks: {
			chirp(): void | Promise<void>;
			submit(audio: Float32Array): Promise<void>;
			cancel(): void;
			error(error: unknown): void;
		},
	) {}

	push(samples: Float32Array, speechPlaying = false): void {
		if (this.#abort.signal.aborted) return;
		if (speechPlaying) {
			if (!this.#playbackSuppressed) this.#reset();
			this.#playbackSuppressed = true;
			this.#tailSamples = Math.round(this.options.playbackTailMs * 16);
			this.#filled = 0;
			this.#level.reset();
			return;
		}
		this.#playbackSuppressed = false;
		if (this.#chirping) return;
		const skipped = Math.min(samples.length, this.#tailSamples);
		this.#tailSamples -= skipped;
		for (let offset = skipped; offset < samples.length;) {
			const count = Math.min(this.#frame.length - this.#filled, samples.length - offset);
			this.#frame.set(samples.subarray(offset, offset + count), this.#filled);
			this.#filled += count;
			offset += count;
			if (this.#filled === this.#frame.length) {
				this.#process(this.#frame);
				this.#filled = 0;
			}
		}
	}

	#process(frame: Float32Array): void {
		if (this.#submitting) return;
		this.#ring.push(frame);
		const voiced = this.#level.accept(frame) && speechBandAccepts(frame);
		if (this.#busy && !this.#recording) {
			this.#candidate.push(frame);
			this.#pendingSpeech ||= voiced;
		}
		this.#gated ||= voiced;
		this.#cadence = Math.min(1000, this.#cadence + 20);
		if (this.#recording) {
			this.#audio.push(frame);
			this.#elapsed += 20;
			this.#speech ||= voiced;
			this.#silence = voiced ? 0 : this.#silence + 20;
			if (!this.#speech && this.#elapsed >= this.options.cancelMs) {
				this.#reset();
				this.callbacks.cancel();
				return;
			}
			if (this.#speech && this.#silence >= this.options.silenceMs) {
				void this.#finish();
				return;
			}
		}
		const word = this.#recording ? this.options.endWord.trim() : "computer";
		if (!word || !this.#gated || this.#busy || this.#cadence < 1000) return;
		this.#cadence = 0;
		this.#gated = false;
		this.#busy = true;
		const recording = this.#recording;
		const generation = this.#generation;
		const window = this.#ring.snapshot();
		if (!recording) {
			this.#candidate.reset();
			this.#candidate.push(window);
			this.#pendingSpeech = false;
		}
		void this.detector
			.detect(window, word, this.#abort.signal)
			.then(async detected => {
				if (!detected.matched || this.#abort.signal.aborted || generation !== this.#generation) return;
				if (recording) {
					await this.#finish();
				} else {
					this.#audio.reset();
					this.#audio.push(this.#candidate.take());
					const earlySpeech = detected.trailingSpeech || this.#pendingSpeech;
					this.#chirping = true;
					try {
						await this.callbacks.chirp();
					} finally {
						this.#chirping = false;
					}
					if (this.#abort.signal.aborted || generation !== this.#generation) return;
					this.#recording = true;
					this.#elapsed = this.#silence = this.#cadence = 0;
					this.#speech = earlySpeech;
					this.#gated = false;
					this.#filled = 0;
					this.#level.reset();
					this.#ring.reset();
				}
			})
			.catch(error => {
				if (!this.#abort.signal.aborted) this.callbacks.error(error);
			})
			.finally(() => {
				this.#busy = false;
				this.#candidate.reset();
			});
	}

	async #finish(): Promise<void> {
		const audio = this.#audio.take();
		this.#reset();
		this.#submitting = true;
		try {
			await this.callbacks.submit(audio);
		} catch (error) {
			if (!this.#abort.signal.aborted) this.callbacks.error(error);
		} finally {
			this.#submitting = false;
		}
	}

	#reset(): void {
		this.#generation++;
		this.#recording = false;
		this.#speech = false;
		this.#gated = false;
		this.#audio.reset();
		this.#candidate.reset();
		this.#elapsed = this.#silence = this.#cadence = 0;
		this.#ring.reset();
	}

	dispose(): void {
		this.#abort.abort();
		this.#reset();
	}
}
