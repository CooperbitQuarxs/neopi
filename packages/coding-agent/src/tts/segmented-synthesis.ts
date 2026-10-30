import { splitSpeechText, type SpeechSegmentOptions } from "./segmenter";
import type { TtsAudio } from "./tts-client";

/** File output has no playback deadline; synthesize bounded segments without artificial waits. */
export async function synthesizeSegments(
	text: string,
	options: SpeechSegmentOptions,
	synthesize: (segment: string) => Promise<TtsAudio | null>,
	signal?: AbortSignal,
): Promise<TtsAudio | null> {
	const chunks: Float32Array[] = [];
	let sampleRate = 0;
	let samples = 0;
	for (const segment of splitSpeechText(text, options)) {
		if (signal?.aborted) return null;
		const audio = await synthesize(segment);
		if (!audio || signal?.aborted) return null;
		if (sampleRate && sampleRate !== audio.sampleRate)
			throw new Error("Local TTS sample rate changed between segments");
		sampleRate = audio.sampleRate;
		chunks.push(audio.pcm);
		samples += audio.pcm.length;
	}
	if (!sampleRate) return null;
	const pcm = new Float32Array(samples);
	let offset = 0;
	for (const chunk of chunks) {
		pcm.set(chunk, offset);
		offset += chunk.length;
	}
	return { pcm, sampleRate };
}
