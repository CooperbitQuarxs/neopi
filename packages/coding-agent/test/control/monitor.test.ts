import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import type { TranscriptLiveState } from "@oh-my-pi/pi-tui/chat/chat-transcript-builder";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { ControlClient } from "../../src/control/client";
import { ControlHost } from "../../src/control/host";
import {
	ControlMonitorService,
	MONITOR_LIVE_BACKPRESSURE_BYTES,
	MONITOR_LIVE_INTERVAL_MS,
	MONITOR_LIVE_MAX_CHARS,
	type MonitorConnection,
	type MonitorGrant,
} from "../../src/control/monitor-service";
import { AgentRegistry, type AgentRef } from "../../src/registry/agent-registry";
import { AgentSession } from "../../src/session/agent-session";
import { SessionManager } from "../../src/session/session-manager";
import { createAssistantMessage, createInMemoryAuthStorage } from "../helpers/agent-session-setup";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface HostFixture {
	host: ControlHost;
	registry: AgentRegistry;
	root: AgentRef;
	sub: AgentRef;
	advisor: AgentRef;
	child: AgentSession;
	connect(capability?: string, probe?: boolean): Promise<ControlClient>;
}

async function hostFixture(): Promise<HostFixture> {
	const temp = TempDir.createSync("npi-mon-");
	const auth = createInMemoryAuthStorage();
	auth.keys.setRuntime("anthropic", "test-key");
	const sessions: AgentSession[] = [];
	const clients: ControlClient[] = [];
	const refs: AgentRef[] = [];
	const registry = AgentRegistry.global();
	let host: ControlHost | undefined;
	cleanups.push(async () => {
		await Promise.all(clients.map(async client => {
			const closed = Promise.withResolvers<void>();
			client.onClose(closed.resolve);
			client.close();
			await closed.promise;
		}));
		await host?.close();
		for (const ref of refs.reverse()) registry.unregister(ref.id, ref);
		for (const session of sessions.reverse()) await session.dispose();
		auth.close();
		await temp.remove();
	});
	const createSession = (): AgentSession => {
		const model = createMockModel({ provider: "anthropic", responses: [] });
		const session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: [], tools: [] },
				streamFn: model.stream,
			}),
			sessionManager: SessionManager.inMemory(temp.path()),
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(auth, temp.join("models.yml")),
		});
		sessions.push(session);
		return session;
	};
	const owner = createSession();
	const child = createSession();
	const rootId = `monitor-${randomUUID()}`;
	const root = registry.register({ id: rootId, displayName: "private-root", kind: "main", session: owner });
	const subFile = temp.join("sub.jsonl");
	const advisorFile = temp.join("advisor.jsonl");
	writeFileSync(subFile, "only-the-granted-sub\n");
	writeFileSync(advisorFile, "private-advisor-transcript\n");
	const sub = registry.register({
		id: `${rootId}/sub`, displayName: "worker", kind: "sub", parentId: rootId,
		session: child, sessionFile: subFile, status: "idle",
	});
	const advisor = registry.register({
		id: `${rootId}/advisor`, displayName: "advisor", kind: "advisor", parentId: rootId,
		session: null, sessionFile: advisorFile, status: "parked", history: { readOnly: true },
	});
	refs.push(root, sub, advisor);
	host = new ControlHost({ session: owner, role: "rpc", dir: temp.path(), tmuxPane: null });
	await host.start();
	const activeHost = host;
	return {
		host, registry, root, sub, advisor, child,
		async connect(capability?: string, probe = false) {
			const publication = activeHost.publication;
			if (!publication) throw new Error("monitor test host did not publish");
			const client = new ControlClient({
				metadata: capability === undefined ? publication.metadata() : { ...publication.metadata(), token: "" },
				label: "monitor-contract", monitorCapability: capability, probe, timeoutMs: 2_000,
			});
			clients.push(client);
			await client.connect();
			return client;
		},
	};
}

function nextEvent(client: ControlClient, type: string): Promise<Record<string, unknown>> {
	const pending = Promise.withResolvers<Record<string, unknown>>();
	const timer = setTimeout(() => {
		unsubscribe();
		pending.reject(new Error(`missing ${type} event`));
	}, 2_000);
	const unsubscribe = client.onEvent(frame => {
		if (frame.type !== type) return;
		clearTimeout(timer);
		unsubscribe();
		pending.resolve(frame);
	});
	return pending.promise;
}

function requireGrant(service: ControlMonitorService, capability: string): MonitorGrant {
	const grant = service.authenticate(capability);
	if (!grant) throw new Error("fresh grant was not authenticated");
	return grant;
}

class MemoryConnection implements MonitorConnection {
	readonly frames: object[] = [];
	bufferedBytes = 0;
	closed = false;
	write(frame: object): void { this.frames.push(frame); }
	close(): void { this.closed = true; }
}

interface ServiceFixture {
	service: ControlMonitorService;
	registry: AgentRegistry;
	root: AgentRef;
	sub: AgentRef;
	connection: MemoryConnection;
	grant: MonitorGrant;
	capability: string;
	bumpGeneration(): void;
}

function serviceFixture(ensureLive: (id: string) => Promise<AgentSession>): ServiceFixture {
	const registry = new AgentRegistry();
	const owner = { sessionName: "owner", sessionManager: { getCwd: () => "/tmp" } } as unknown as AgentSession;
	const root = registry.register({ id: "owner", displayName: "owner", kind: "main", session: owner });
	const sub = registry.register({
		id: "owner/sub", displayName: "worker", kind: "sub", parentId: root.id, session: null, status: "parked",
	});
	let generation = 1;
	const service = new ControlMonitorService({ session: owner, registry, generation: () => generation,
		lifecycle: () => ({ ensureLive }) });
	cleanups.push(() => service.dispose());
	const { capability } = service.grant(sub.id);
	const grant = requireGrant(service, capability);
	const connection = new MemoryConnection();
	return { service, registry, root, sub, grant, capability, connection,
		bumpGeneration: () => { generation++; service.recheck(); } };
}

function promptTarget(delivered: Array<{ text: string; behavior: string }>): AgentSession {
	return {
		prompt: async (text: string, options: { streamingBehavior: string }) => {
			delivered.push({ text, behavior: options.streamingBehavior });
		},
	} as unknown as AgentSession;
}

describe("monitor capability socket boundary", () => {
	test("token-less monitor hello has scope but no host snapshot; other commands are monitor_only", async () => {
		const fixture = await hostFixture();
		const info = fixture.host.monitor.grant(fixture.sub.id);
		const monitor = await fixture.connect(info.capability);
		expect(monitor.snapshot).toBeUndefined();
		expect(monitor.monitorScope).toEqual({ agentId: fixture.sub.id, kind: "sub", canChat: true });
		for (const type of ["state", "get_status", "input", "slash", "agents", "monitor_grant", "subscribe"]) {
			const reply = await monitor.request({ type, text: "must not reach root", agentId: fixture.advisor.id });
			expect(reply.success).toBe(false);
			expect(reply.code).toBe("monitor_only");
			expect(reply.data).toBeUndefined();
		}
		const transcript = await monitor.request({ type: "monitor_transcript", agentId: fixture.advisor.id });
		expect(transcript.success).toBe(true);
		expect((transcript.data as { text: string }).text).toBe("only-the-granted-sub\n");
		const full = await fixture.connect();
		expect(full.snapshot?.session?.sessionId).toBe(fixture.root.session?.sessionId);
		expect((await full.request({ type: "state" })).success).toBe(true);
		const probe = await fixture.connect(undefined, true);
		expect((await probe.request({ type: "state" })).success).toBe(true);
	});

	test("a wrong monitor capability is unauthorized even without a publication token", async () => {
		const fixture = await hostFixture();
		await expect(fixture.connect("0".repeat(64))).rejects.toMatchObject({ code: "unauthorized" });
	});

	test("advisor capabilities cannot chat or redirect chat to a subagent", async () => {
		const fixture = await hostFixture();
		const info = fixture.host.monitor.grant(fixture.advisor.id);
		const monitor = await fixture.connect(info.capability);
		expect(monitor.monitorScope?.canChat).toBe(false);
		const reply = await monitor.request({ type: "monitor_chat", agentId: fixture.sub.id, text: "hello" });
		expect(reply.success).toBe(false);
		expect(reply.code).toBe("read_only");
	});

	for (const change of ["remove", "replace"] as const) {
		test(`${change} of the exact ref sends monitor_gone and closes its socket`, async () => {
			const fixture = await hostFixture();
			const info = fixture.host.monitor.grant(fixture.sub.id);
			const monitor = await fixture.connect(info.capability);
			expect((await monitor.request({ type: "monitor_subscribe" })).success).toBe(true);
			const gone = nextEvent(monitor, "monitor_gone");
			const closed = Promise.withResolvers<void>();
			monitor.onClose(closed.resolve);
			if (change === "remove") fixture.registry.unregister(fixture.sub.id, fixture.sub);
			else {
				const replacement = fixture.registry.register({ ...fixture.sub, session: null, status: "parked" });
				cleanups.push(() => { fixture.registry.unregister(replacement.id, replacement); });
			}
			expect((await gone).agentId).toBe(fixture.sub.id);
			await closed.promise;
			expect(monitor.closed).toBe(true);
			expect(fixture.host.monitor.authenticate(info.capability)).toBeUndefined();
		});
	}

	test("a generation bump invalidates even an authenticated monitor that has not subscribed", async () => {
		const fixture = await hostFixture();
		const info = fixture.host.monitor.grant(fixture.sub.id);
		const monitor = await fixture.connect(info.capability);
		const gone = nextEvent(monitor, "monitor_gone");
		const closed = Promise.withResolvers<void>();
		monitor.onClose(closed.resolve);
		fixture.host.bumpGeneration();
		expect((await gone).agentId).toBe(fixture.sub.id);
		await closed.promise;
		expect(fixture.host.monitor.authenticate(info.capability)).toBeUndefined();
	});

	test("subscription carries in-flight session state and coalesces a synchronous event burst", async () => {
		const fixture = await hostFixture();
		const initial = createAssistantMessage("initial in-flight assistant");
		fixture.child.agent.emitExternalEvent({ type: "message_start", message: initial });
		const info = fixture.host.monitor.grant(fixture.sub.id);
		const monitor = await fixture.connect(info.capability);
		const subscribed = await monitor.request({ type: "monitor_subscribe" });
		expect((subscribed.data as { live: TranscriptLiveState }).live.assistant).toEqual(initial);
		const frames: Record<string, unknown>[] = [];
		const unsubscribe = monitor.onEvent(frame => { if (frame.type === "monitor_live") frames.push(frame); });
		const next = nextEvent(monitor, "monitor_live");
		fixture.child.agent.emitExternalEvent({ type: "tool_execution_start", toolCallId: "call", toolName: "lookup", args: {} });
		for (let index = 0; index < 30; index++) {
			const message: AssistantMessage = { ...initial, content: [{ type: "text", text: `stream ${index}` }] };
			fixture.child.agent.emitExternalEvent({ type: "message_update", message,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: String(index), partial: message } });
			fixture.child.agent.emitExternalEvent({ type: "tool_execution_update", toolCallId: "call", toolName: "lookup",
				args: {}, partialResult: { content: [{ type: "text", text: `progress ${index}` }] } });
		}
		const live = (await next).state as TranscriptLiveState;
		expect(live.assistant?.content).toEqual([{ type: "text", text: "stream 29" }]);
		expect(live.tools[0]?.partialResult?.content).toEqual([{ type: "text", text: "progress 29" }]);
		await monitor.request({ type: "monitor_transcript" });
		expect(frames).toHaveLength(1);
		unsubscribe();
	});

	test("initial and pushed live states stay bounded even when tool arguments exceed the cap", async () => {
		const fixture = await hostFixture();
		const initial = createAssistantMessage("x".repeat(MONITOR_LIVE_MAX_CHARS + 1));
		fixture.child.agent.emitExternalEvent({ type: "message_start", message: initial });
		fixture.child.agent.emitExternalEvent({ type: "tool_execution_update", toolCallId: "huge", toolName: "lookup",
			args: { text: "y".repeat(MONITOR_LIVE_MAX_CHARS + 1) }, partialResult: { content: [] } });
		const info = fixture.host.monitor.grant(fixture.sub.id);
		const monitor = await fixture.connect(info.capability);
		const subscribed = await monitor.request({ type: "monitor_subscribe" });
		const state = (subscribed.data as { live: TranscriptLiveState }).live;
		expect(JSON.stringify(state).length).toBeLessThanOrEqual(MONITOR_LIVE_MAX_CHARS);
		const next = nextEvent(monitor, "monitor_live");
		fixture.child.agent.emitExternalEvent({ type: "tool_execution_start", toolCallId: "huge", toolName: "lookup",
			args: { text: "y".repeat(MONITOR_LIVE_MAX_CHARS + 1) } });
		const pushed = await next;
		expect(JSON.stringify(pushed.state).length).toBeLessThanOrEqual(MONITOR_LIVE_MAX_CHARS);
		expect(pushed.omitted).toBe("assistant");
	});

	test("a slow monitor waits for writable bytes to drain instead of queueing live frames", async () => {
		const fixture = await hostFixture();
		const info = fixture.host.monitor.grant(fixture.sub.id);
		const grant = requireGrant(fixture.host.monitor, info.capability);
		const connection = new MemoryConnection();
		connection.bufferedBytes = MONITOR_LIVE_BACKPRESSURE_BYTES + 1;
		expect((await fixture.host.monitor.handle(connection, grant, { type: "monitor_subscribe" })).success).toBe(true);
		fixture.child.agent.emitExternalEvent({ type: "message_start", message: createAssistantMessage("latest") });
		await Bun.sleep(MONITOR_LIVE_INTERVAL_MS + 30);
		expect(connection.frames).toHaveLength(0);
		connection.bufferedBytes = 0;
		await Bun.sleep(MONITOR_LIVE_INTERVAL_MS + 30);
		expect(connection.frames).toHaveLength(1);
		expect((connection.frames[0] as { state: TranscriptLiveState }).state.assistant?.content)
			.toEqual([{ type: "text", text: "latest" }]);
	});
});

describe("monitor chat revival ownership", () => {
	test("a parked subagent revives and receives a trimmed steer without retargeting the owner", async () => {
		const delivered: Array<{ text: string; behavior: string }> = [];
		const target = promptTarget(delivered);
		const revived = Promise.withResolvers<AgentSession>();
		const requested: string[] = [];
		const fixture = serviceFixture(id => { requested.push(id); return revived.promise; });
		const pending = fixture.service.handle(fixture.connection, fixture.grant, { type: "monitor_chat", text: "  follow up  " });
		expect(requested).toEqual([fixture.sub.id]);
		fixture.sub.session = target;
		fixture.registry.setStatus(fixture.sub.id, "idle", fixture.sub);
		revived.resolve(target);
		expect((await pending).success).toBe(true);
		expect(delivered).toEqual([{ text: "follow up", behavior: "steer" }]);
	});

	for (const change of ["replaced", "aborted", "revoked", "generation", "wrong-session"] as const) {
		test(`revival re-check rejects a ${change} target before prompting`, async () => {
			const delivered: Array<{ text: string; behavior: string }> = [];
			const target = promptTarget(delivered);
			const revived = Promise.withResolvers<AgentSession>();
			const fixture = serviceFixture(() => revived.promise);
			const pending = fixture.service.handle(fixture.connection, fixture.grant, { type: "monitor_chat", text: "must not send" });
			fixture.sub.session = target;
			if (change === "replaced") fixture.registry.register({ ...fixture.sub, session: target, status: "idle" });
			else if (change === "aborted") fixture.registry.setStatus(fixture.sub.id, "aborted", fixture.sub);
			else if (change === "revoked") fixture.service.revoke(fixture.capability);
			else if (change === "generation") fixture.bumpGeneration();
			else fixture.sub.session = promptTarget([]);
			revived.resolve(target);
			const reply = await pending;
			expect(reply.success).toBe(false);
			expect(reply.code).toBe(change === "aborted" ? "read_only" : "monitor_gone");
			expect(delivered).toHaveLength(0);
		});
	}

	test("strict root identity and ancestry invalidate a capability", () => {
		const fixture = serviceFixture(async () => { throw new Error("must not revive"); });
		fixture.registry.register({ ...fixture.root });
		expect(fixture.service.authenticate(fixture.capability)).toBeUndefined();
		const fresh = fixture.service.grant(fixture.sub.id);
		fixture.sub.parentId = "missing-parent";
		expect(fixture.service.authenticate(fresh.capability)).toBeUndefined();
		expect(() => fixture.service.grant(fixture.sub.id)).toThrow("unknown agent");
	});
});
