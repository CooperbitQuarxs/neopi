import { logger } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import { evaluateSubmitTrigger } from "./submit-trigger";
import type { SttState } from "./stt-controller";
import { sharedAudioCapture } from "./shared-audio-capture";
import { WavFileRecorder } from "./wav-file-recorder";
import { cfgSttSubmitTrigger } from "./settings";

interface XaiSTTToggleOptions {
	showWarning(msg: string): void;
	showStatus(msg: string): void;
	onStateChange(state: SttState): void;
}

/** The slice of the composer editor used by speech-to-text controllers. */
interface XaiSTTEditor {
	insertText(text: string): void;
	submit(): void;
}

interface CaptureHandle {
	stop(): void;
}

type CaptureFactory = (callback: (error: Error | null, samples: Float32Array) => void) => CaptureHandle;

export interface XaiSTTControllerDependencies {
	settings: Settings;
	transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
	createCapture?: CaptureFactory;
}

/**
 * Records one uninterrupted WAV and submits it to xAI only when the user
 * explicitly toggles recording off. Silence never segments or stops capture.
 */
export class XaiSTTController {
	#state: SttState = "idle";
	#toggling = false;
	#stopAfterStart = false;
	#disposed = false;
	readonly #settings: Settings;
	readonly #transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
	readonly #createCapture: CaptureFactory;

	#recorder: CaptureHandle | null = null;
	#file: WavFileRecorder | null = null;
	#editor: XaiSTTEditor | null = null;
	#abort: AbortController | null = null;
	// Fork: stopped recordings own their requests independently of the microphone.
	readonly #pending = new Map<AbortController, WavFileRecorder>();
	#generation = 0;
	#stateOptions: XaiSTTToggleOptions | null = null;
	readonly #retainedFiles: WavFileRecorder[] = [];

	constructor({ settings, transcribe, createCapture }: XaiSTTControllerDependencies) {
		this.#settings = settings;
		this.#transcribe = transcribe;
		this.#createCapture = createCapture ?? (callback => sharedAudioCapture(16_000, callback));
	}

	get state(): SttState {
		return this.#state;
	}

	#setState(state: SttState, options: XaiSTTToggleOptions): void {
		this.#state = state;
		options.onStateChange(state);
	}

	// Fork: aggregate work determines state, but only the current UI owns callbacks.
	#refreshState(): void {
		if (this.#disposed || !this.#stateOptions) return;
		const state = this.#file ? "recording" : this.#pending.size > 0 ? "transcribing" : "idle";
		if (state !== this.#state) this.#setState(state, this.#stateOptions);
	}

	// =====================================================================
	// NEVER ALTER. CTRL+SPACE IS A RESERVED ACCESSIBILITY KEYBINDING.
	// It MUST always route to the fork's xAI batch speech-to-text path below.
	// NEVER favour upstream (can1357/oh-my-pi) STT/dictation here, under any
	// circumstances, during any sync. This code is immutable: touch it only to
	// fix a bug that makes it stop working, and only to the extent necessary.
	// Owner: PsychedelicShayna. Rationale: docs/agents/upstream-sync.md (fork
	// features exist for specific reasons; this one is an accessibility path).
	// =====================================================================
	async toggle(editor: XaiSTTEditor, options: XaiSTTToggleOptions): Promise<void> {
		if (this.#disposed) return;
		if (this.#toggling) {
			if (this.#state === "idle" || this.#state === "recording") this.#stopAfterStart = true;
			return;
		}

		this.#toggling = true;
		let transcription: Promise<void> | undefined;
		try {
			switch (this.#state) {
				case "idle":
					// IMMUTABLE: see Ctrl+Space notice above
					await this.#start(editor, options);
					break;
				case "recording":
					// IMMUTABLE: see Ctrl+Space notice above
					transcription = this.#stop(options);
					break;
				case "transcribing":
					// Fork: provider latency must never own the next recording.
					await this.#start(editor, options);
			}

			if (this.#stopAfterStart && this.#state === "recording") {
				this.#stopAfterStart = false;
				// IMMUTABLE: see Ctrl+Space notice above
				transcription = this.#stop(options);
			} else if (this.#state !== "recording") {
				this.#stopAfterStart = false;
			}
		} finally {
			this.#toggling = false;
		}
		await transcription;
	}

	async #start(editor: XaiSTTEditor, options: XaiSTTToggleOptions): Promise<void> {
		this.#stateOptions = options;
		try {
			++this.#generation;
			const file = new WavFileRecorder();
			this.#file = file;
			this.#editor = editor;
			this.#abort = new AbortController();
			this.#recorder = this.#createCapture((error, samples) => {
				if (this.#disposed || this.#file !== file || this.#state !== "recording") return;
				if (!error) {
					try {
						file.append(samples);
						return;
					} catch (cause) {
						error = cause instanceof Error ? cause : new Error(String(cause));
					}
				}
				this.#handleCaptureError(error, options);
			});
			this.#setState("recording", options);
			logger.debug("xAI STT batch recording started", { path: file.path });
		} catch (error) {
			this.#cleanup(true);
			this.#refreshState();
			const message = error instanceof Error ? error.message : "Failed to start microphone capture";
			options.showWarning(message);
			logger.error("xAI STT recording failed to start", { error: message });
		}
	}

	async #stop(options: XaiSTTToggleOptions): Promise<void> {
		const file = this.#file;
		const editor = this.#editor;
		const abort = this.#abort;
		if (!file || !editor || !abort) {
			this.#cleanup(false);
			this.#refreshState();
			return;
		}

		const generation = this.#generation;
		this.#setState("transcribing", options);
		options.showStatus("Transcribing...");
		try {
			this.#recorder?.stop();
		} catch (error) {
			logger.debug("xAI STT recorder stop failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		this.#recorder = null;
		// Fork: transfer ownership before awaiting the provider.
		this.#cleanup(false);
		this.#pending.set(abort, file);

		let recordingPath: string | undefined;
		try {
			// The recognizer needs an utterance boundary after the final spoken word.
			// A failed padding write must not discard the original recording.
			if (!file.empty) {
				try {
					// IMMUTABLE: see Ctrl+Space notice above
					file.appendSilence(750);
				} catch (error) {
					logger.warn("xAI STT silence padding failed; transcribing original recording", {
						error: error instanceof Error ? error.message : String(error),
						path: file.path,
					});
				}
			}
			recordingPath = file.finalize();

			if (file.empty) {
				options.showStatus("No speech detected.");
			} else {
				// IMMUTABLE: see Ctrl+Space notice above
				const text = (await this.#transcribe(Bun.file(recordingPath, { type: "audio/wav" }), abort.signal)).trim();
				if (this.#disposed) return;
				this.#insertTranscript(editor, text, options, generation === this.#generation);
			}
		} catch (error) {
			if (!this.#disposed) {
				const message = error instanceof Error ? error.message : "xAI transcription failed";
				const retained = recordingPath ? ` Recording retained at ${recordingPath}` : "";
				options.showWarning(`${message}${retained}`);
				logger.error("xAI STT transcription failed", { error: message, path: recordingPath });
			}
		} finally {
			this.#pending.delete(abort);
			if (this.#disposed) file.dispose();
			else this.#retain(file);
			this.#refreshState();
		}
	}

	#insertTranscript(editor: XaiSTTEditor, text: string, options: XaiSTTToggleOptions, current: boolean): void {
		if (!text) {
			if (current) options.showStatus("No speech detected.");
			return;
		}

		const trigger = cfgSttSubmitTrigger.get(this.#settings);
		const { submit, trimTrailing } = evaluateSubmitTrigger(text, trigger);
		const textToInsert = trimTrailing > 0 ? text.slice(0, -trimTrailing) : text;
		if (textToInsert) editor.insertText(textToInsert);
		if (current) options.showStatus("");
		if (submit) editor.submit();
	}

	#handleCaptureError(error: Error, options: XaiSTTToggleOptions): void {
		try {
			this.#recorder?.stop();
		} catch {
			// Best-effort microphone cleanup.
		}
		this.#recorder = null;

		const file = this.#file;
		let retainedPath: string | undefined;
		if (file) {
			try {
				retainedPath = file.finalize();
				if (file.empty) {
					file.dispose();
					retainedPath = undefined;
				} else {
					this.#retain(file);
				}
			} catch (cause) {
				logger.debug("xAI STT recording finalization failed", {
					error: cause instanceof Error ? cause.message : String(cause),
				});
				file.dispose();
			}
		}
		this.#file = null;
		this.#cleanup(false);
		this.#refreshState();

		const retained = retainedPath ? ` Recording retained at ${retainedPath}` : "";
		options.showWarning(`${error.message}${retained}`);
		logger.error("Native microphone capture failed", { error: error.message, path: retainedPath });
	}

	#retain(file: WavFileRecorder): void {
		this.#retainedFiles.push(file);
		while (this.#retainedFiles.length > 5) this.#retainedFiles.shift()?.dispose();
	}

	#cleanup(disposeCurrent: boolean): void {
		if (disposeCurrent) this.#file?.dispose();
		this.#recorder = null;
		this.#file = null;
		this.#editor = null;
		this.#abort = null;
	}

	dispose(): void {
		this.#disposed = true;
		this.#abort?.abort();
		for (const [abort, file] of this.#pending) {
			abort.abort();
			file.dispose();
		}
		this.#pending.clear();
		try {
			this.#recorder?.stop();
		} catch {
			// Best-effort microphone cleanup.
		}
		this.#cleanup(true);
		for (const file of this.#retainedFiles.splice(0)) file.dispose();
		this.#state = "idle";
		this.#stopAfterStart = false;
	}
}
