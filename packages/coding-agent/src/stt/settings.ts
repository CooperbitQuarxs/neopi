/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";
import { STT_SUBMIT_TRIGGER_OPTIONS, STT_SUBMIT_TRIGGER_VALUES } from "./submit-trigger";

// Speech-to-text
export const cfgSttEnabled = register({
	id: "stt.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Speech-to-Text",
		description: "Enable speech-to-text input via microphone",
	},
});

export const cfgSttLanguage = register({ id: "stt.language", type: "string", default: "en" });

export const cfgSttSubmitTrigger = register({
	id: "stt.submitTrigger",
	type: "enum",
	values: STT_SUBMIT_TRIGGER_VALUES,
	default: "never",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Speech-to-Text Submit Trigger",
		description:
			"Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit.",
		options: STT_SUBMIT_TRIGGER_OPTIONS,
	},
});

export const cfgWakeEnabled = register({
	id: "stt.wake.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake-word listening",
		description:
			"Listen locally for computer, then record and submit a complete request. Off closes the wake microphone.",
	},
});
export const cfgWakeSilenceMs = register({
	id: "stt.wake.silenceMs",
	type: "number",
	default: 2000,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake silence timeout",
		description: "Milliseconds of silence ending a spoken request, clamped to 200–30000.",
		options: [
			{ value: "1000", label: "1 second" },
			{ value: "2000", label: "2 seconds" },
			{ value: "3000", label: "3 seconds" },
		],
	},
});
export const cfgWakeCancelMs = register({
	id: "stt.wake.cancelMs",
	type: "number",
	default: 3000,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake misactivation timeout",
		description: "Cancel without submitting if no speech follows the chirp, clamped to 2000–5000 ms.",
		options: [
			{ value: "2000", label: "2 seconds" },
			{ value: "3000", label: "3 seconds" },
			{ value: "5000", label: "5 seconds" },
		],
	},
});
export const cfgWakeEndWord = register({
	id: "stt.wake.endWord",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake end word",
		description:
			"Optional spoken word ending a request. Empty uses silence only. Recognized locally; removed before submission.",
	},
});
export const cfgWakeChirpPath = register({
	id: "stt.wake.chirpPath",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake chirp sound",
		description:
			"Path to a PCM16 mono WAV activation sound. Empty plays a generated short tone; no recording is bundled.",
	},
});
export const cfgWakeContinueChirpPath = register({
	id: "stt.wake.continueChirpPath",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake continuation sound",
		description:
			"Path to a PCM16 mono WAV, at most two seconds, played when speech capture ends and transcription starts. Empty is silent.",
	},
});
export const cfgWakeEndChirpPath = register({
	id: "stt.wake.endChirpPath",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake end sound",
		description:
			"Path to a PCM16 mono WAV, at most two seconds, played when transcription succeeds, before submitting the transcript. Empty is silent.",
	},
});

export const cfgWakeSuppressWhileSpeaking = register({
	id: "stt.wake.suppressWhileSpeaking",
	type: "boolean",
	default: true,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Suppress wake word while speaking",
		description:
			'On prevents NeoPi\'s own speech triggering the wake word through speakers. Off lets you interrupt by saying "computer", but needs headphones or echo cancellation.',
	},
});

export const cfgWakePlaybackTailMs = register({
	id: "stt.wake.playbackTailMs",
	type: "number",
	default: 300,
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Wake playback echo tail",
		description:
			"With wake suppression enabled, ignore microphone audio for this many milliseconds after assistant speech. Clamped to 0–3000. The readiness chirp has no tail delay.",
		options: [
			{ value: "150", label: "150 ms" },
			{ value: "300", label: "300 ms" },
			{ value: "500", label: "500 ms" },
		],
	},
});
