import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { setAgentDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings, settings } from "../src/config/settings";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { AgentSession } from "../src/session/agent-session";
import type { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import * as capture from "../src/stt/shared-audio-capture";
import { cfgSttSubmitTrigger } from "../src/stt/settings";
import * as xai from "../src/stt/xai-stt";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

describe("xAI main-composer destination ownership", () => {
	let saved: SettingsTestState;
	let directory: string;
	let auth: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;
	let audio: capture.AudioSink[];

	beforeAll(async () => { await initTheme(); });
	beforeEach(async () => {
		saved = beginSettingsTest();
		const root = os.tmpdir();
		await fs.mkdir(root, { recursive: true });
		directory = await fs.mkdtemp(path.join(root, "stt-destination-"));
		setAgentDir(directory);
		await Settings.init({ inMemory: true, cwd: directory });
		cfgSttSubmitTrigger.set(settings, "never");
		auth = createInMemoryAuthStorage();
		const registry = new ModelRegistry(auth);
		const model = registry.find("anthropic", "claude-sonnet-4-5")!;
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(directory, directory), settings, modelRegistry: registry,
		});
		mode = new InteractiveMode(session, "test");
		vi.spyOn(mode.ui, "requestRender").mockImplementation(() => {});
		vi.spyOn(mode, "showWarning").mockImplementation(() => {});
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode, "refreshSlashCommandState").mockResolvedValue(undefined);
		mode.setEditorComponent(undefined);
		mode.editor.disableSubmit = false;
		audio = [];
		vi.spyOn(capture, "sharedAudioCapture").mockImplementation((_rate, callback) => {
			audio.push(callback);
			return { stop() {} };
		});
		vi.spyOn(xai, "transcribeXaiAudio").mockResolvedValue("NEW SPEECH");
	});
	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		auth?.close();
		vi.restoreAllMocks();
		restoreSettingsTestState(saved);
		await fs.rm(directory, { recursive: true, force: true });
	});

	it.each(["recording", "transcribing"] as const)("resolves the replacement composer during %s", async phase => {
		const result = Promise.withResolvers<string>();
		vi.spyOn(xai, "transcribeXaiAudio").mockReturnValue(result.promise);
		mode.editor.setText("Existing draft: ");
		const detached = mode.editor;
		await mode.handleSTTToggle();
		audio[0]!(null, new Float32Array([0.5]));
		const stopped = phase === "transcribing" ? mode.handleSTTToggle() : undefined;
		mode.setEditorComponent(undefined);
		const replacement = mode.editor;
		expect(detached.cursorOverride).toBeUndefined();
		expect(replacement.cursorOverride).toBeDefined();
		result.resolve("NEW SPEECH");
		await (stopped ?? mode.handleSTTToggle());
		expect(replacement.getText()).toBe("Existing draft: NEW SPEECH");
		expect(detached.getText()).toBe("Existing draft: ");
		expect(replacement.cursorOverride).toBeUndefined();
	});
});
