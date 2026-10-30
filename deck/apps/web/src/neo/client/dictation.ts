/**
 * Dictation everywhere: the composer records with MediaRecorder and sends
 * the clip here. Contract (backend-contracts.md §8):
 *   POST /api/dictation/transcribe  audio/webm body → { text }
 * The deck routes it through xAI STT with a local parakeet fallback. The
 * preview adapter cannot transcribe and says so.
 */
import { SOURCES } from "./source";

export interface DictationClient {
	transcribe(clip: Blob): Promise<string>;
}

export class DictationUnavailable extends Error {
	constructor() {
		super("Dictation isn't wired on this deck yet.");
		this.name = "DictationUnavailable";
	}
}

const previewDictation: DictationClient = {
	async transcribe() {
		throw new DictationUnavailable();
	},
};

const liveDictation: DictationClient = {
	async transcribe(clip) {
		const res = await fetch("/api/dictation/transcribe", { method: "POST", headers: { "content-type": clip.type || "audio/webm" }, body: clip });
		if (res.status === 404) throw new DictationUnavailable();
		if (!res.ok) throw new Error(`Transcription failed (${res.status}).`);
		return ((await res.json()) as { text: string }).text;
	},
};

export const dictation: DictationClient = SOURCES.dictation === "live" ? liveDictation : previewDictation;
