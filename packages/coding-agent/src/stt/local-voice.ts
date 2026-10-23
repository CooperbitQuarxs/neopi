import type { Settings } from "../config/settings";
import { cfgVoiceEnabled, cfgVoicePostprocess } from "../tts/settings";
import { WakeListener, type WakeListenerDependencies } from "./wake-listener";

export interface LocalVoiceDependencies extends Omit<WakeListenerDependencies, "settings" | "submit" | "stopped"> {
	isSpeechPlaying(): boolean;
	settings: Settings;
	/** Submit directly to the owning session, not the focused pane or composer. */
	request(text: string): Promise<string | undefined>;
	speak(text: string, signal: AbortSignal): Promise<void>;
	postprocess(text: string, instruction: string, signal: AbortSignal): Promise<string | null>;
	clearSpeech(): void;
}

/** One interactive session's opt-in, independent of profile settings and other sessions. */
export class LocalVoiceMode {
	readonly settings: Settings;
	#listener: WakeListener | undefined;
	#abort: AbortController | undefined;
	#replyAbort: AbortController | undefined;

	constructor(readonly deps: LocalVoiceDependencies) {
		this.settings = deps.settings.overlay({ "voice.enabled": false, "stt.wake.enabled": true });
	}

	get enabled(): boolean {
		return cfgVoiceEnabled.get(this.settings);
	}

	async enable(): Promise<boolean> {
		if (this.enabled) return true;
		const abort = new AbortController();
		this.#abort = abort;
		cfgVoiceEnabled.override(this.settings, true);
		const listener = new WakeListener({
			...this.deps,
			settings: this.settings,
			submit: async text => {
				void this.#request(text);
			},
			isSpeechPlaying: () => !!this.#replyAbort || this.deps.isSpeechPlaying(),
			activated: () => this.#interruptReply(),
			stopped: () => {
				abort.abort();
				this.#interruptReply();
				if (this.#abort === abort) cfgVoiceEnabled.override(this.settings, false);
			},
		});
		this.#listener = listener;
		const started = await listener.start();
		if (!started && this.#listener === listener) this.disable();
		return started;
	}

	disable(): void {
		const wasEnabled = this.enabled;
		cfgVoiceEnabled.override(this.settings, false);
		this.#interruptReply();
		this.#abort?.abort();
		this.#abort = undefined;
		this.#listener?.stop();
		this.#listener = undefined;
		if (wasEnabled) this.deps.clearSpeech();
	}

	#interruptReply(): void {
		this.#replyAbort?.abort();
		this.#replyAbort = undefined;
		this.deps.clearSpeech();
	}

	async #request(text: string): Promise<void> {
		if (!this.enabled || this.#abort?.signal.aborted) return;
		this.#interruptReply();
		const abort = new AbortController();
		this.#replyAbort = abort;
		const signal = abort.signal;
		try {
			const reply = await this.deps.request(text);
			if (!reply || signal.aborted) return;
			let spoken = reply;
			const instruction = cfgVoicePostprocess.get(this.settings).trim();
			if (instruction) {
				try {
					spoken = (await this.deps.postprocess(reply, instruction, signal)) || reply;
				} catch {
					// A failed optional rewrite must not discard the agent's reply.
				}
			}
			if (!signal.aborted) await this.deps.speak(spoken, signal);
		} catch (error) {
			if (!signal.aborted) this.deps.warning(error instanceof Error ? error.message : String(error));
		} finally {
			if (this.#replyAbort === abort) this.#replyAbort = undefined;
		}
	}
}
