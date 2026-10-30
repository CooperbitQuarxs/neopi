import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import {
	resolveChronicleSummaryRoleSelection,
	resolveChroniclerRoleSelection,
} from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import {
	getKnownRoleIds,
	getRoleInfo,
	MODEL_ROLE_IDS,
	setRoleDescription,
} from "@oh-my-pi/pi-coding-agent/config/model-roles";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { beginSettingsTest, restoreSettingsTestState } from "./helpers/settings-test-state";

function makeModel(id: string, metadata: Partial<Pick<Model, "api" | "kind" | "webSearch">> = {}): Model {
	return buildModel({
		id,
		name: id,
		api: "ollama-chat",
		provider: "fixture",
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 1024,
		...metadata,
	});
}

const chat = makeModel("chat");
const explicitChat = makeModel("explicit-chat", { kind: "chat" });
const groundedChat = makeModel("grounded-chat", { webSearch: "gemini" });
const tiny = makeModel("tiny", { kind: "tiny" });
const image = makeModel("image", { kind: "image" });
const search = makeModel("search", { kind: "search" });
const speech = makeModel("speech", { kind: "tts" });
const localDictation = makeModel("local-dictation", { api: "local-inference", kind: "stt" });
const cloudDictation = makeModel("cloud-dictation", { api: "openai-transcriptions", kind: "stt" });
const judge = makeModel("judge", { kind: "judge" });
const fixtures = [chat, explicitChat, groundedChat, tiny, image, search, speech, localDictation, cloudDictation, judge];

function acceptedIds(role: string, settings: Settings): string[] {
	return fixtures.filter(getRoleInfo(role, settings).accepts).map(model => model.id);
}

describe("getRoleInfo", () => {
	test("built-in roles accept models by capability", () => {
		const settings = Settings.isolated({});

		expect(acceptedIds("default", settings)).toEqual(["chat", "explicit-chat", "grounded-chat"]);
		expect(acceptedIds("deck-inbox", settings)).toEqual(["chat", "explicit-chat", "grounded-chat"]);
		expect(acceptedIds("tiny", settings)).toEqual(["chat", "explicit-chat", "grounded-chat", "tiny"]);
		expect(acceptedIds("memory", settings)).toEqual(["chat", "explicit-chat", "grounded-chat", "tiny"]);
		expect(acceptedIds("image", settings)).toEqual(["image"]);
		expect(acceptedIds("web", settings)).toEqual(["grounded-chat", "search"]);
		expect(acceptedIds("speech", settings)).toEqual(["speech"]);
		expect(acceptedIds("dictation", settings)).toEqual(["local-dictation", "cloud-dictation"]);
		expect(acceptedIds("judge", settings)).toEqual(["chat", "explicit-chat", "grounded-chat", "tiny", "judge"]);
	});

	test("custom metadata overrides presentation without widening model acceptance", () => {
		const settings = Settings.isolated({
			modelTags: {
				smol: { name: "My Smol", color: "success", hidden: true },
				custom: { name: "My Custom Tag", color: "error", hidden: true },
			},
		});

		const smol = getRoleInfo("smol", settings);
		expect(smol).toMatchObject({ name: "My Smol", color: "success", hidden: true, section: "chat" });
		expect(fixtures.filter(smol.accepts)).toEqual([chat, explicitChat, groundedChat]);

		const custom = getRoleInfo("custom", settings);
		expect(custom).toMatchObject({ name: "My Custom Tag", color: "error", hidden: true, section: "chat" });
		expect(fixtures.filter(custom.accepts)).toEqual([chat, explicitChat, groundedChat]);
	});

	test("kind roles remain in the kind section when their presentation is overridden", () => {
		const settings = Settings.isolated({
			modelTags: {
				image: { name: "Pictures", color: "warning" },
			},
		});

		const info = getRoleInfo("image", settings);
		expect(info).toMatchObject({ name: "Pictures", color: "warning", section: "kind" });
		expect(fixtures.filter(info.accepts)).toEqual([image]);
	});
});

test("built-in descriptions and custom role metadata survive real settings initialization", async () => {
	const cacheDir = path.join(os.homedir(), ".cache/npi-canary");
	await fs.mkdir(cacheDir, { recursive: true });
	const root = await fs.mkdtemp(path.join(cacheDir, "role-description-"));
	const state = beginSettingsTest();
	try {
		const settings = await Settings.init({ cwd: root, agentDir: path.join(root, "agent") });
		for (const role of MODEL_ROLE_IDS) expect(getRoleInfo(role, settings).description?.length).toBeGreaterThan(0);
		expect(getRoleInfo("owner-role", settings).description).toBeUndefined();
		setRoleDescription("owner-role", "My own role", settings);
		await settings.flush();
		const loaded = await Settings.loadReadOnly({ cwd: root, agentDir: path.join(root, "agent") });
		expect(getRoleInfo("owner-role", loaded).description).toBe("My own role");
		expect(getKnownRoleIds(loaded)).toContain("owner-role");
		setRoleDescription("default", "", settings);
		expect(getRoleInfo("default", settings).description).toBe("");
	} finally {
		restoreSettingsTestState(state);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("chronicler selection is independent and unset capture uses the slow priority chain", () => {
	const luna = createMockModel({ provider: "openai-codex", id: "gpt-5.6-luna" }).model;
	const sol = createMockModel({ provider: "openai-codex", id: "gpt-5.6-sol" }).model;
	const available = [luna, sol];
	const explicit = Settings.isolated({
		modelRoles: { chronicler: "openai-codex/gpt-5.6-luna", slow: "openai-codex/gpt-5.6-sol" },
	});
	const unset = Settings.isolated({
		modelRoles: { default: "openai-codex/gpt-5.6-luna", slow: "openai-codex/gpt-5.6-luna" },
	});
	expect(resolveChroniclerRoleSelection(explicit, available)?.model).toBe(luna);
	expect(resolveChroniclerRoleSelection(unset, available)?.model).toBe(sol);
});

test("chronicler-summary selection wins when set and otherwise follows the configured chronicler role", () => {
	const luna = createMockModel({ provider: "openai-codex", id: "gpt-5.6-luna" }).model;
	const sol = createMockModel({ provider: "openai-codex", id: "gpt-5.6-sol" }).model;
	const terra = createMockModel({ provider: "openai-codex", id: "gpt-5.6-terra" }).model;
	const available = [luna, sol, terra];
	const explicit = Settings.isolated({
		modelRoles: {
			"chronicler-summary": "openai-codex/gpt-5.6-terra",
			chronicler: "openai-codex/gpt-5.6-luna",
			slow: "openai-codex/gpt-5.6-sol",
		},
	});
	const inherited = Settings.isolated({
		modelRoles: { chronicler: "openai-codex/gpt-5.6-luna", slow: "openai-codex/gpt-5.6-sol" },
	});
	expect(resolveChronicleSummaryRoleSelection(explicit, available)?.model).toBe(terra);
	expect(resolveChronicleSummaryRoleSelection(inherited, available)?.model).toBe(luna);
});
