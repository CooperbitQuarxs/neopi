import { describe, expect, test } from "bun:test";
import { createPacedSpeechStream, SpeechPacer, type PacingClock } from "../../src/tts/paced-stream";

class FakeClock implements PacingClock {
	time = 0;
	waits: number[] = [];
	now() {
		return this.time;
	}
	async sleep(ms: number) {
		this.waits.push(ms);
		this.time += ms;
	}
}

describe("paced speech deadlines", () => {
	test("measured synthesis and audio rates converge", () => {
		const clock = new FakeClock();
		const estimate = { synthesisMsPerChar: 10, audioMsPerChar: 20 };
		const pacer = new SpeechPacer(estimate, 100, clock);
		for (let i = 0; i < 40; i++) pacer.observe(100, 200, 6000);
		expect(estimate.synthesisMsPerChar).toBeCloseTo(2, 3);
		expect(estimate.audioMsPerChar).toBeCloseTo(60, 2);
	});

	test("a slow segment advances the next synthesis start", () => {
		const clock = new FakeClock();
		const pacer = new SpeechPacer({ synthesisMsPerChar: 2, audioMsPerChar: 60 }, 100, clock);
		pacer.buffer(6000);
		const before = pacer.delay(100);
		pacer.observe(100, 1000, 6000);
		expect(pacer.delay(100)).toBeLessThan(before);
		expect(pacer.delay(100)).toBeCloseTo(5060);
	});

	test("favorable synthesis idles without underrunning the playback horizon", async () => {
		const clock = new FakeClock();
		const stream = createPacedSpeechStream({
			enabled: true,
			pacer: new SpeechPacer({ synthesisMsPerChar: 10, audioMsPerChar: 100 }, 100, clock),
			async synthesize() {
				clock.time += 100;
				return { pcm: new Float32Array(1000), sampleRate: 1000 };
			},
		});
		for (let i = 0; i < 20; i++) stream.push("0123456789");
		stream.end();
		let horizon = 0;
		let gaps = 0;
		for await (const chunk of stream.chunks) {
			if (chunk.index > 0 && clock.now() > horizon) gaps++;
			horizon = Math.max(clock.now(), horizon) + 1000;
		}
		expect(gaps).toBe(0);
		expect(clock.waits).toHaveLength(19);
		expect(clock.waits.every(ms => ms >= 800)).toBe(true);
	});

	test("an unfavorable synthesis estimate never inserts extra delay", () => {
		const pacer = new SpeechPacer({ synthesisMsPerChar: 100, audioMsPerChar: 20 }, 350, new FakeClock());
		pacer.buffer(2000);
		expect(pacer.delay(100)).toBe(0);
	});

	test("idle intervals preserve FIFO and never overlap synthesis despite underprediction", async () => {
		const clock = new FakeClock();
		const starts: number[] = [];
		const inputs: string[] = [];
		let active = 0;
		let maxActive = 0;
		const stream = createPacedSpeechStream({
			pacer: new SpeechPacer({ synthesisMsPerChar: 1, audioMsPerChar: 100 }, 100, clock),
			enabled: true,
			async synthesize(text) {
				active++;
				maxActive = Math.max(active, maxActive);
				starts.push(clock.now());
				inputs.push(text);
				clock.time += inputs.length === 2 ? 3000 : 100;
				await Promise.resolve();
				active--;
				return { pcm: new Float32Array(2000), sampleRate: 1000 };
			},
		});
		for (const text of ["first", "second", "third"]) stream.push(text);
		stream.end();
		const output = [];
		for await (const chunk of stream.chunks) output.push([chunk.index, chunk.text]);
		expect(output).toEqual([
			[0, "first"],
			[1, "second"],
			[2, "third"],
		]);
		expect(inputs).toEqual(["first", "second", "third"]);
		expect(maxActive).toBe(1);
		expect(starts[1]).toBeGreaterThan(100);
		expect(starts[2]).toBeGreaterThanOrEqual(starts[1]! + 3000);
	});

	test("does not synthesize queued utterances until playback consumes them", async () => {
		const clock = new FakeClock();
		let calls = 0;
		const stream = createPacedSpeechStream({
			enabled: true,
			pacer: new SpeechPacer({ synthesisMsPerChar: 1, audioMsPerChar: 10 }, 0, clock),
			async synthesize() {
				calls++;
				return { pcm: new Float32Array(10), sampleRate: 1000 };
			},
		});
		stream.push("hello");
		stream.end();
		await Promise.resolve();
		expect(calls).toBe(0);
		for await (const _chunk of stream.chunks) {
		}
		expect(calls).toBe(1);
	});

	test("disabled pacing never sleeps and cancellation drops remaining segments", async () => {
		const clock = new FakeClock();
		const abort = new AbortController();
		let calls = 0;
		const stream = createPacedSpeechStream({
			enabled: false,
			signal: abort.signal,
			pacer: new SpeechPacer({ synthesisMsPerChar: 1, audioMsPerChar: 10 }, 0, clock),
			async synthesize() {
				calls++;
				return { pcm: new Float32Array(1000), sampleRate: 1000 };
			},
		});
		stream.push("one");
		stream.push("two");
		stream.push("three");
		stream.end();
		for await (const chunk of stream.chunks) if (chunk.index === 1) abort.abort();
		expect(calls).toBe(2);
		expect(clock.waits).toEqual([]);
	});

	test("aborting an idle input wakes and closes the iterator", async () => {
		const abort = new AbortController();
		const stream = createPacedSpeechStream({
			enabled: true,
			signal: abort.signal,
			pacer: new SpeechPacer({ synthesisMsPerChar: 1, audioMsPerChar: 10 }, 0, new FakeClock()),
			synthesize: async () => {
				throw new Error("unexpected synthesis");
			},
		});
		const pending = stream.chunks.next();
		abort.abort();
		expect((await pending).done).toBe(true);
	});
});
