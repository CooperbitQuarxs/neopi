import { describe, expect, test } from "bun:test";
import { DEFAULT_SPEECH_SEGMENTS, splitSpeechText } from "../../src/tts/segmenter";
import { SpeakableStream } from "../../src/tts/speakable";
import { synthesizeSegments } from "../../src/tts/segmented-synthesis";

const options = { ...DEFAULT_SPEECH_SEGMENTS, firstChars: 60, minChars: 12, maxChars: 60 };

describe("paced boundary ladder", () => {
	test("prefers a sentence to a later comma and keeps dot runs intact", () => {
		const segments = splitSpeechText(
			"We have reached the harbor... The ship is ready, and the crew will leave soon.",
			options,
		);
		expect(segments[0]).toBe("We have reached the harbor...");
	});
	test("prefers commas to conjunctions, and conjunctions to other punctuation", () => {
		expect(splitSpeechText("We have reached the harbor, and the crew is ready; so we go", options)[0]).toBe(
			"We have reached the harbor,",
		);
		expect(splitSpeechText("We have reached the harbor and the crew is ready; so we go", options)[0]).toBe(
			"We have reached the harbor",
		);
	});
	test("skips internal punctuation until a closing quote or parenthesis", () => {
		const text = 'He said "the ship is here, and it is ready." We can leave.';
		expect(splitSpeechText(text, options)[0]).toBe('He said "the ship is here, and it is ready."');
		expect(splitSpeechText("The ship (which is ready, and waiting) will leave soon.", options)[0]).toContain(
			"(which is ready, and waiting)",
		);
	});
	test("streaming never emits an unclosed quote and final flush preserves every word", () => {
		const stream = new SpeakableStream({ ...options, firstChars: 25, maxChars: 30 });
		const first = stream.push('He said "the ship has arrived, and');
		expect(first.join(" ")).not.toContain('"');
		const all = [...first, ...stream.push(' the crew is ready." We can leave.'), ...stream.flush()];
		expect(all.join(" ")).toBe('He said "the ship has arrived, and the crew is ready." We can leave.');
		expect(all.some(x => x.includes('"the ship has arrived, and the crew is ready."'))).toBe(true);
	});
	test("word fallback preserves text, and boundary switches disable their tier", () => {
		const text = "one two three four five six seven eight nine ten eleven twelve";
		const chunks = splitSpeechText(text, { ...options, firstChars: 60, maxWords: 4 });
		expect(chunks[0]).toBe("one two three four");
		expect(chunks.join(" ")).toBe(text);
		const phrase = "We reached the harbor... the ship is ready and waiting";
		expect(splitSpeechText(phrase, { ...options, ellipsis: false, conjunctions: false })[0]).toBe(phrase);
	});
	test("short first chunk precedes larger later segments", () => {
		const chunks = splitSpeechText(
			"Hello from the ship. " + "The morning was quiet and the water was blue. ".repeat(12),
			{ ...options, firstChars: 30, maxChars: 150, minChars: 50 },
		);
		expect(chunks[0]).toBe("Hello from the ship.");
		expect(chunks[1]!.length).toBeGreaterThan(chunks[0]!.length);
	});
});

describe("segmented local file output", () => {
	test("synthesizes all text in bounded calls and concatenates PCM in order", async () => {
		const inputs: string[] = [];
		const text = "The ship is ready. ".repeat(100);
		const audio = await synthesizeSegments(text, options, async segment => {
			inputs.push(segment);
			return { pcm: new Float32Array([inputs.length]), sampleRate: 24000 };
		});
		expect(inputs.length).toBeGreaterThan(1);
		expect(inputs.every(x => x.length <= 60)).toBe(true);
		expect(inputs.join(" ")).toBe(text.trim());
		expect(Array.from(audio!.pcm)).toEqual(inputs.map((_, i) => i + 1));
	});
	test("does not return a partial file after a failed segment or cancellation", async () => {
		let calls = 0;
		expect(
			await synthesizeSegments("The ship is ready. ".repeat(10), options, async () =>
				++calls === 2 ? null : { pcm: new Float32Array(1), sampleRate: 24000 },
			),
		).toBeNull();
		const abort = new AbortController();
		abort.abort();
		expect(
			await synthesizeSegments(
				"hello",
				options,
				async () => {
					throw new Error("unexpected");
				},
				abort.signal,
			),
		).toBeNull();
	});
});
