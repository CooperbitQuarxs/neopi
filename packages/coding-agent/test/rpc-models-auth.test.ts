import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { RpcModelsCommands } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-models-commands";
import { RpcModelsConfiguration } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-models-configuration";
import type { RpcCommand } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { credentialPinHash } from "@oh-my-pi/pi-coding-agent/session/credential-pin";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

describe("native provider and account RPC contracts", () => {
	let auth: AuthStorage;
	let registry: ModelRegistry;
	let session: AgentSession;
	let manager: SessionManager;
	let commands: RpcModelsCommands;

	beforeEach(() => {
		auth = createInMemoryAuthStorage();
		registry = new ModelRegistry(auth);
		const model = registry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Missing native test model");
		vi.spyOn(registry, "getAll").mockReturnValue([model]);
		vi.spyOn(registry, "getAvailable").mockReturnValue([model]);
		manager = SessionManager.inMemory();
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: [], tools: [], messages: [] } }),
			sessionManager: manager,
			settings: Settings.isolated(),
			modelRegistry: registry,
		});
		commands = new RpcModelsCommands({ session, output: () => {}, pending: new Map(), input: async () => undefined });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await session.dispose();
		auth.close();
	});

	async function saveAccount(provider: string, accountId: string): Promise<number> {
		const entries = await auth.credentials.upsert(provider, {
			type: "oauth",
			access: `secret-access-${accountId}`,
			refresh: `secret-refresh-${accountId}`,
			expires: Date.now() + 3_600_000,
			accountId,
			email: `${accountId}@example.com`,
		});
		const entry = entries.find(
			entry =>
				entry.provider === provider &&
				entry.credential.type === "oauth" &&
				entry.credential.accountId === accountId,
		);
		if (!entry) throw new Error("Missing saved test account");
		return entry.id;
	}

	test("login metadata follows declarative and custom device flows and keeps credential aliases", async () => {
		auth.keys.setRuntime("openai-codex", "secret-runtime-key");
		const response = await commands.handle({ type: "get_login_providers" });
		if (!response.success || response.command !== "get_login_providers") throw new Error("Missing login providers");
		expect(response.data.providers.find(provider => provider.id === "charm-hyper")).toMatchObject({
			loginKind: "api-key",
			deviceCode: false,
		});
		expect(response.data.providers.find(provider => provider.id === "anthropic")).toMatchObject({
			loginKind: "oauth-code",
			deviceCode: false,
			acceptsKeys: true,
		});
		expect(response.data.providers.find(provider => provider.id === "kimi-code")).toMatchObject({
			loginKind: "device-code",
			deviceCode: true,
		});
		expect(response.data.providers.find(provider => provider.id === "github-copilot")).toMatchObject({
			loginKind: "custom",
			deviceCode: true,
		});
		expect(response.data.providers.find(provider => provider.id === "openai-codex-device")).toMatchObject({
			loginKind: "custom",
			deviceCode: true,
			storeCredentialsAs: "openai-codex",
			authenticated: true,
			acceptsKeys: true,
		});
		expect(response.data.providers.find(provider => provider.id === "exa")).toMatchObject({ acceptsKeys: false });
		const configuration = await new RpcModelsConfiguration(session).read();
		const codex = configuration.providers.find(provider => provider.id === "openai-codex");
		expect(codex?.loginProviders.find(provider => provider.id === "openai-codex-device")).toMatchObject({
			loginKind: "custom",
			deviceCode: true,
			storeCredentialsAs: "openai-codex",
		});
		for (const provider of configuration.providers)
			expect(provider.acceptsKeys).toBe(registry.hasProvider(provider.id));
		expect(JSON.stringify([response, configuration])).not.toContain("secret-runtime-key");
	});

	test("login forwards the structured user verification code without credential material", async () => {
		const frames: object[] = [];
		vi.spyOn(auth.oauth, "login").mockImplementation(async (_provider, ctrl) => {
			ctrl.onAuth({
				url: "https://example.com/verify",
				instructions: "Complete verification",
				userCode: "REAL-CODE",
			});
			return { type: "oauth", accountId: "signed-in-account" };
		});
		vi.spyOn(registry, "refreshProvider").mockResolvedValue(undefined);
		const login = new RpcModelsCommands({
			session,
			output: frame => frames.push(frame),
			pending: new Map(),
			input: async () => undefined,
		});
		expect(
			await login.handle({ type: "login", providerId: "openai-codex-device", id: "device-login" }),
		).toMatchObject({ success: true, data: { providerId: "openai-codex-device" } });
		expect(frames).toEqual([
			{
				type: "extension_ui_request",
				id: expect.any(String),
				method: "open_url",
				url: "https://example.com/verify",
				instructions: "Complete verification",
				userCode: "REAL-CODE",
				loginId: "device-login",
			},
		]);
	});

	test("activation pins a noncurrent provider only for this session and journals its identity hash once", async () => {
		const first = await saveAccount("openai-codex", "first");
		const second = await saveAccount("openai-codex", "second");
		expect(auth.sessions.pin("openai-codex", "other-session", first)).toBe(true);
		const before = session.model;
		const response = await commands.handle({
			id: "activate",
			type: "activate_account",
			providerId: "openai-codex",
			credentialId: second,
		});
		expect(response).toEqual({ id: "activate", type: "response", command: "activate_account", success: true });
		expect(auth.oauth.accounts("openai-codex", session.sessionId).find(account => account.active)?.credentialId).toBe(
			second,
		);
		expect(auth.oauth.accounts("openai-codex", "other-session").find(account => account.active)?.credentialId).toBe(
			first,
		);
		expect(session.model).toBe(before);
		expect(manager.getCredentialPins().get("openai-codex")?.hash).toBe(
			credentialPinHash("openai-codex", { accountId: "second", email: "second@example.com" }),
		);
		await commands.handle({ type: "activate_account", providerId: "openai-codex", credentialId: second });
		expect(manager.getBranch().filter(entry => entry.type === "credential_pin")).toHaveLength(1);
		const serialized = JSON.stringify([
			response,
			manager.getBranch(),
			await commands.handle({ type: "get_logout_accounts", providerId: "openai-codex" }),
		]);
		expect(serialized).not.toContain("secret-access-");
		expect(serialized).not.toContain("secret-refresh-");
	});

	test("unknown providers, foreign accounts, API keys and malformed activation never change the pin", async () => {
		const account = await saveAccount("openai-codex", "active");
		const foreign = await saveAccount("anthropic", "foreign");
		const keyEntries = await auth.credentials.upsert("openai-codex", { type: "api_key", key: "secret-stored-key" });
		const key = keyEntries.find(entry => entry.provider === "openai-codex" && entry.credential.type === "api_key");
		if (!key) throw new Error("Missing stored test key");
		await commands.handle({ type: "activate_account", providerId: "openai-codex", credentialId: account });
		const pin = manager.getCredentialPins().get("openai-codex");
		const invalid = [
			{ providerId: "unknown-provider", credentialId: account },
			{ providerId: "openai-codex", credentialId: foreign },
			{ providerId: "openai-codex", credentialId: key.id },
			{ providerId: "openai-codex", credentialId: Number.MAX_SAFE_INTEGER },
			{ providerId: "openai-codex", credentialId: "secret-malformed-id" },
			{ providerId: "openai-codex", credentialId: 0 },
			{ providerId: null, credentialId: account },
		];
		for (const params of invalid) {
			const command = { type: "activate_account", ...params } as Extract<RpcCommand, { type: "activate_account" }>;
			const response = await commands.handle(command);
			expect(response).toMatchObject({ success: false, code: "invalid_value" });
			expect(JSON.stringify(response)).not.toContain("secret-");
			expect(
				auth.oauth.accounts("openai-codex", session.sessionId).find(account => account.active)?.credentialId,
			).toBe(account);
			expect(manager.getCredentialPins().get("openai-codex")).toEqual(pin);
		}
	});

	test("busy activation and runtime auth overrides do not create a journal pin", async () => {
		const account = await saveAccount("openai-codex", "candidate");
		session.agent.state.isStreaming = true;
		try {
			expect(
				await commands.handle({ type: "activate_account", providerId: "openai-codex", credentialId: account }),
			).toMatchObject({ success: false, code: "session_busy" });
		} finally {
			session.agent.state.isStreaming = false;
		}
		auth.keys.setRuntime("openai-codex", "secret-override");
		expect(
			await commands.handle({ type: "activate_account", providerId: "openai-codex", credentialId: account }),
		).toMatchObject({ success: false, code: "invalid_value" });
		expect(manager.getCredentialPins().size).toBe(0);
	});
});
