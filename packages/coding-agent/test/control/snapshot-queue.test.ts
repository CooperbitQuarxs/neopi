/**
 * A queue larger than one protocol frame must not lock control clients out:
 * `hello` and `state` carry a bounded copy, and RPC `get_state` keeps the
 * whole queue.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { ControlClient } from "../../src/control/client";
import { ControlHost } from "../../src/control/host";
import type { ControlSnapshot } from "../../src/control/types";
import { MAX_RPC_REASSEMBLED_BYTES } from "../../src/modes/rpc/rpc-frame";
import { buildRpcSessionState, CONTROL_QUEUE_LIMIT } from "../../src/modes/rpc/rpc-session-state";
import { AgentSession } from "../../src/session/agent-session";
import type { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

describe("control snapshot queue", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession | undefined;
	let host: ControlHost | undefined;
	let client: ControlClient | undefined;
	let hosts = 0;

	beforeAll(() => {
		tempDir = TempDir.createSync("@pi-control-queue-");
		authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("anthropic", "test-key");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		client?.close();
		client = undefined;
		await host?.close();
		host = undefined;
		await session?.dispose();
		session = undefined;
	});

	afterAll(async () => {
		authStorage.close();
		await tempDir.remove();
	});

	/** A session whose queue reads as `steering` plus one follow-up, behind a published host and a connected client. */
	async function startWithQueue(
		steering?: string[],
		followUp: string[] = [],
	): Promise<{ client: ControlClient; hello: ControlSnapshot }> {
		const model = createMockModel({ provider: "anthropic", responses: [] });
		session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: [], tools: [] },
				streamFn: model.stream,
			}),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage, tempDir.join("models.yml")),
		});
		if (steering)
			vi.spyOn(session, "getQueuedMessages").mockReturnValue({ steering, followUp: ["later"], liveSteered: 1 });
		for (const content of followUp) session.agent.followUp({ role: "user", content, timestamp: Date.now() });
		host = new ControlHost({ session, role: "rpc", dir: tempDir.join(`control-${++hosts}`), tmuxPane: null });
		await host.start();
		const publication = host.publication;
		if (!publication) throw new Error("control host did not publish");
		client = new ControlClient({ metadata: publication.metadata(), label: "test", kind: "cli" });
		return { client, hello: await client.connect() };
	}

	function expectBounded(queue: { steering: readonly string[]; followUp: readonly string[]; liveSteered: number }) {
		expect(queue.liveSteered).toBe(1);
		expect(queue.steering).toHaveLength(CONTROL_QUEUE_LIMIT.entries);
		expect(queue.steering[0]).toBe("steer 0");
		expect(queue.steering.at(-1)).toBe(`steer ${CONTROL_QUEUE_LIMIT.entries - 1}`);
		expect(queue.followUp).toEqual(["later"]);
	}

	const overLimit = () => [
		...Array.from({ length: CONTROL_QUEUE_LIMIT.entries + 10 }, (_, i) => `steer ${i}`),
		"q".repeat(MAX_RPC_REASSEMBLED_BYTES + 1),
	];

	test("a queue past the frame limit still lets clients connect, with a bounded copy", async () => {
		const steering = overLimit();
		const { client, hello } = await startWithQueue(steering);
		const state = (await client.request({ type: "state" })).data as ControlSnapshot;
		for (const snapshot of [hello, state]) expectBounded(snapshot.session!.queuedMessages);

		// RPC get_state builds without a limit and keeps every entry whole.
		const full = buildRpcSessionState(session!, { includeDump: false });
		expect(full.queuedMessages.steering).toHaveLength(steering.length);
		expect(full.queuedMessages.steering.at(-1)).toHaveLength(steering.at(-1)!.length);
	});

	test("long queue-chip text remains actionable for promotion and removal", async () => {
		const text = "keep the exact prompt ".repeat(300);
		const { client, hello } = await startWithQueue(undefined, [text, `${text} promote`]);
		const [removeChip, promoteChip] = hello.session!.queuedMessages.followUp;
		expect(
			(await client.request({ type: "remove_queued_message", message: removeChip!, queue: "followUp" })).data,
		).toMatchObject({ removed: true });
		expect((await client.request({ type: "promote_queued_message", message: promoteChip! })).data).toEqual({
			promoted: true,
		});
	});

	test("a text-budget overflow omits the remaining prefix without rewriting queue commands", async () => {
		const { hello } = await startWithQueue(["first", "q".repeat(CONTROL_QUEUE_LIMIT.chars), "last"]);
		expect(hello.session!.queuedMessages.steering).toEqual(["first"]);
	});

	test("subscribers keep receiving queue updates, bounded the same way", async () => {
		const { client } = await startWithQueue(overLimit());
		const updates: Record<string, unknown>[] = [];
		const errors: Record<string, unknown>[] = [];
		client.onEvent(frame => {
			if (frame.type === "queue_update") updates.push(frame);
			if (frame.type === "rpc_frame_error") errors.push(frame);
		});
		expect((await client.request({ type: "subscribe", events: "lifecycle" })).success).toBe(true);

		// Any queue change makes the session emit its (spied) queue.
		session!.agent.followUp({ role: "user", content: "nudge", timestamp: Date.now() });
		await Bun.sleep(100);

		expect(errors).toEqual([]);
		expect(updates).toHaveLength(1);
		expectBounded(updates[0] as { steering: string[]; followUp: string[]; liveSteered: number });
	});
});
