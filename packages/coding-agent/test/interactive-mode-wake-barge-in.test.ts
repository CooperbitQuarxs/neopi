import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { setAgentDir } from "@oh-my-pi/pi-utils";
import * as runtimeDirs from "@oh-my-pi/pi-utils/dirs";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings, settings } from "../src/config/settings";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { AgentSession } from "../src/session/agent-session";
import type { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import * as asr from "../src/stt/asr-client";
import * as downloader from "../src/stt/downloader";
import * as capture from "../src/stt/shared-audio-capture";
import { STTController } from "../src/stt/stt-controller";
import { decodePcm16Wav } from "../src/stt/wav";
import { StreamingAudioPlayer } from "../src/tts/streaming-player";
import { ttsClient } from "../src/tts/tts-client";
import { vocalizer } from "../src/tts/vocalizer";
import { createAssistantMessage, createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

const silence = (ms: number) => new Float32Array(ms * 16);
const fixture = async (name: string) =>
	decodePcm16Wav(new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/wake-word/${name}.wav`).arrayBuffer()))
		.samples;
async function until(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 400 && !predicate(); i++) await Bun.sleep(5);
	expect(predicate()).toBe(true);
}

describe("interactive wake interruption keeps the next reply audible", () => {
	let saved: SettingsTestState;
	let directory: string;
	let auth: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;
	let sink: capture.AudioSink | undefined;
	let modelCalls: number;
	let firstStream: AssistantMessageEventStream | undefined;
	let holdFirstGeneration: boolean;
	let heldPlayback: PromiseWithResolvers<void>;
	let heard: number[];
	let stopped: number[];
	const audioIds = new WeakMap<StreamingAudioPlayer, number>();

	beforeAll(async () => {
		await initTheme();
	});
	beforeEach(async () => {
		saved = beginSettingsTest();
		const root = path.join(saved.agentDir, "wake-barge-in");
		await fs.mkdir(root, { recursive: true });
		directory = await fs.mkdtemp(path.join(root, "audible-"));
		setAgentDir(directory);
		vi.spyOn(runtimeDirs, "getGlobalDaemonRuntimeDir").mockReturnValue(directory);
		await Settings.init({
			inMemory: true,
			cwd: directory,
			overrides: {
				"stt.wake.suppressWhileSpeaking": false,
				"voice.postprocess": "",
				"speech.enabled": true,
				"speech.enhanced": false,
				"speech.mode": "assistant",
				"tts.pacing": false,
				"compaction.enabled": false,
				"startup.quiet": true,
				modelRoles: { speech: "local/kokoro-paced" },
			},
		});
		auth = createInMemoryAuthStorage();
		const registry = new ModelRegistry(auth, undefined, { settings });
		vi.spyOn(registry, "getApiKey").mockResolvedValue("test-key");
		const model = registry.find("openai", "gpt-4o-mini")!;
		modelCalls = 0;
		holdFirstGeneration = false;
		firstStream = undefined;
		const agent = new Agent({
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: () => {
				const stream = new AssistantMessageEventStream();
				const call = ++modelCalls;
				const message = createAssistantMessage(call === 1 ? "First reply." : "Steered reply.");
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					stream.push({ type: "text_start", contentIndex: 0, partial: message });
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: message.content[0]!.type === "text" ? message.content[0]!.text : "",
						partial: message,
					});
					if (call === 1 && holdFirstGeneration) firstStream = stream;
					else stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.create(directory, directory),
			settings,
			modelRegistry: registry,
		});
		heard = [];
		stopped = [];
		heldPlayback = Promise.withResolvers<void>();
		vi.spyOn(StreamingAudioPlayer.prototype, "start").mockImplementation(() => {});
		vi.spyOn(StreamingAudioPlayer.prototype, "write").mockImplementation(function (this: StreamingAudioPlayer, pcm) {
			if (pcm.length !== 1) return; // Readiness chirps are not reply playback.
			const id = pcm[0]!;
			audioIds.set(this, id);
			heard.push(id);
		});
		vi.spyOn(StreamingAudioPlayer.prototype, "end").mockImplementation(function (this: StreamingAudioPlayer) {
			return audioIds.get(this) === 1 ? heldPlayback.promise : Promise.resolve();
		});
		vi.spyOn(StreamingAudioPlayer.prototype, "stop").mockImplementation(function (this: StreamingAudioPlayer) {
			const id = audioIds.get(this);
			if (id !== undefined) stopped.push(id);
			if (id === 1) heldPlayback.resolve();
		});
		vi.spyOn(ttsClient, "synthesize").mockImplementation(async (_model, text) => ({
			pcm: new Float32Array([text.includes("First") ? 1 : 2]),
			sampleRate: 24000,
		}));
		vi.spyOn(ttsClient, "synthesizeStream").mockImplementation(() => {
			const input = Promise.withResolvers<string>();
			return {
				push: text => input.resolve(text),
				end() {},
				chunks: (async function* () {
					const text = await input.promise;
					yield { pcm: new Float32Array([text.includes("First") ? 1 : 2]), sampleRate: 24000, index: 0, text };
				})(),
			};
		});
		vi.spyOn(downloader, "downloadSttModel").mockResolvedValue(undefined);
		vi.spyOn(asr.sttClient, "transcribe").mockResolvedValue("computer");
		vi.spyOn(STTController.prototype, "transcribeRecording")
			.mockResolvedValueOnce("Computer, first request")
			.mockResolvedValueOnce("Computer, redirect request");
		vi.spyOn(capture, "sharedAudioCapture").mockImplementation((_rate, callback) => {
			sink = callback;
			return {
				stop() {
					sink = undefined;
				},
			};
		});
		mode = new InteractiveMode(session, "test");
		vi.spyOn(mode.ui, "requestRender").mockImplementation(() => {});
		vi.spyOn(mode.ui.terminal, "write").mockImplementation(() => {});
		vi.spyOn(mode.composer, "start").mockImplementation(() => {});
		vi.spyOn(mode.composer, "stop").mockImplementation(() => {});
		vi.spyOn(mode, "showWarning").mockImplementation(() => {});
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode, "refreshSlashCommandState").mockResolvedValue(undefined);
		await mode.init({ suppressWelcomeIntro: true });
	});
	afterEach(async () => {
		heldPlayback?.resolve();
		firstStream?.push({ type: "done", reason: "stop", message: createAssistantMessage("First reply.") });
		mode?.stop();
		await session?.dispose();
		vocalizer.clear();
		vocalizer.setModelSource(null);
		auth?.close();
		vi.restoreAllMocks();
		restoreSettingsTestState(saved);
		await fs.rm(directory, { recursive: true, force: true });
	});

	async function wake(): Promise<void> {
		sink?.(null, await fixture("computer"));
		sink?.(null, silence(1000));
		for (let i = 0; i < 32; i++) await Promise.resolve();
	}
	async function request(): Promise<void> {
		sink?.(null, await fixture("request"));
		sink?.(null, silence(3000));
	}

	it("sends the second /voice reply through real speakReply after interrupting first playback", async () => {
		const prompt = vi.spyOn(session, "prompt");
		const idle = vi.spyOn(session, "waitForIdle");
		const speak = vi.spyOn(vocalizer, "speakReply");
		await mode.handleLocalVoiceCommand("on");
		await wake();
		await request();
		await until(() => heard.includes(1));
		await wake();
		expect(stopped).toContain(1);
		await request();
		await until(() => heard.includes(2));
		expect(prompt.mock.calls.map(call => [call[0], call[1]?.streamingBehavior])).toEqual([
			["first request", "steer"],
			["redirect request", "steer"],
		]);
		expect(idle.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(speak.mock.calls.map(call => call[0])).toEqual(["First reply.", "Steered reply."]);
		expect(heard).toEqual([1, 2]);
		expect(mode.showWarning).not.toHaveBeenCalled();
	});

	it("speaks the steered turn after real session turn_start releases streaming interruption", async () => {
		holdFirstGeneration = true;
		const initial = session.prompt("first request");
		await until(() => firstStream !== undefined);
		// The partial sentence is flushed by the real vocalizer idle timer.
		await until(() => heard.includes(1));
		vocalizer.interruptTurn();
		expect(stopped).toContain(1);
		firstStream!.push({
			type: "text_delta",
			contentIndex: 0,
			delta: "Late text stays silent. ",
			partial: createAssistantMessage("First reply. Late text stays silent. "),
		});
		await Bun.sleep(1100);
		expect(heard).toEqual([1]);
		await session.prompt("redirect request", { streamingBehavior: "steer" });
		firstStream!.push({ type: "done", reason: "stop", message: createAssistantMessage("First reply.") });
		await initial;
		await session.waitForIdle();
		await until(() => heard.includes(2));
		expect(modelCalls).toBe(2);
		expect(heard).toEqual([1, 2]);
		expect(mode.showWarning).not.toHaveBeenCalled();
	});
});
