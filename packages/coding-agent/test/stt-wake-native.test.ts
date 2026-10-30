import { afterAll, describe, expect, it } from "bun:test";
import { shutdownSttClient } from "../src/stt/asr-client";
import { downloadSttModel } from "../src/stt/downloader";
import { DEFAULT_STT_MODEL_KEY } from "../src/stt/models";
import { ParakeetKeywordDetector } from "../src/stt/wake-listener";
import { decodePcm16Wav } from "../src/stt/wav";

// Opt-in because this exercises the real native model and its subprocess, not a mock.
// Use PI_CODING_AGENT_DIR pointing at an isolated cache containing Parakeet weights.
describe.skipIf(process.env.NPI_WAKE_NATIVE_TEST !== "1")("wake word real Parakeet fixtures", () => {
	afterAll(async () => {
		await shutdownSttClient();
	});
	it("recognizes computer and rejects a different spoken request", async () => {
		await downloadSttModel(DEFAULT_STT_MODEL_KEY);
		const detector = new ParakeetKeywordDetector();
		const signal = new AbortController().signal;
		const read = async (name: string) =>
			decodePcm16Wav(
				new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/wake-word/${name}.wav`).arrayBuffer()),
			).samples;
		expect((await detector.detect(await read("computer"), "computer", signal)).matched).toBe(true);
		expect((await detector.detect(await read("request"), "computer", signal)).matched).toBe(false);
	});
});
