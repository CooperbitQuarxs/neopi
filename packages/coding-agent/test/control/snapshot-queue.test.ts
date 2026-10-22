/**
 * A queue larger than one protocol frame must not lock control clients out:
 * `hello` and `state` carry a bounded copy, and RPC `get_state` keeps the
 * whole queue.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { ControlClient } from "../../src/control/client";
import { ControlHost } from "../../src/control/host";
import type { ControlSnapshot } from "../../src/control/types";
import { MAX_RPC_REASSEMBLED_BYTES, RpcFrameEncoder } from "../../src/modes/rpc/rpc-frame";
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
		autoApprove = false,
	): Promise<{ client: ControlClient; hello: ControlSnapshot }> {
		const model = createMockModel({ provider: "anthropic", responses: [] });
		session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: [], tools: [] },
				streamFn: model.stream,
			}),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated({
				"compaction.enabled": false,
				"retry.enabled": false,
				"tools.approvalMode": "always-ask",
			}),
			modelRegistry: new ModelRegistry(authStorage, tempDir.join("models.yml")),
			autoApprove,
		});
		if (steering)
			vi.spyOn(session, "getQueuedMessages").mockReturnValue({
				steering,
				followUp: followUp.length > 0 ? followUp : ["later"],
				liveSteered: 1,
			});
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

	test("state retains journal-wide cost after leaving a branch and keeps native permission separate", async () => {
		const { client } = await startWithQueue();
		const manager = session!.sessionManager;
		const root = manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "recorded before compaction" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			stopReason: "stop",
			timestamp: 2,
			usage: {
				input: 25, output: 5, cacheRead: 75, cacheWrite: 0, totalTokens: 105,
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6 },
			},
		};
		manager.appendMessage(message);
		manager.branch(root);
		// The active in-memory transcript has none of the billed response.
		expect(session!.messages).toHaveLength(0);
		const state = (await client.request({ type: "state" })).data as ControlSnapshot;
		expect(state.session!.sessionUsage).toMatchObject({
			input: 25, cacheRead: 75, cost: 6, advisorCost: 0, advisorCostState: "ready",
		});
		expect(state.session!.approvalMode).toBe("always-ask");
	});

	test("state reports the process auto-approve override rather than the saved policy", async () => {
		const { hello } = await startWithQueue(undefined, [], true);
		expect(hello.session!.approvalMode).toBe("yolo");
	});

	test("busy summary names both delivery paths and counts steering plus follow-up", async () => {
		const { client } = await startWithQueue(undefined, ["later"]);
		await session!.steer("change course");
		const state = (await client.request({ type: "state" })).data as ControlSnapshot;
		expect(state.busy.pendingSteerAndFollowUp).toBe(2);
		expect(state.busy).not.toHaveProperty("queued");
		expect(state.session!.queuedMessages.steering).toEqual(["change course"]);
		expect(state.session!.queuedMessages.followUp).toEqual(["later"]);
	});

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

	test("protocol-v1 snapshots and queue updates retain both worst-case escaped queue budgets", async () => {
		const text = "\0".repeat(CONTROL_QUEUE_LIMIT.chars);
		const { hello } = await startWithQueue([text], [text]);
		const encoder = new RpcFrameEncoder();
		const snapshotFrame = { type: "response", command: "hello", success: true, data: hello };
		expect(JSON.parse(encoder.encode(snapshotFrame))).toEqual(snapshotFrame);
		const update = { type: "queue_update", ...hello.session!.queuedMessages };
		expect(JSON.parse(encoder.encode(update))).toEqual(update);
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
