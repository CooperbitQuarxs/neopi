import { afterEach, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GraphValue, Routine, RoutineGraph } from "@npi-deck/protocol";
import { closeDb, getDb, openDb } from "../db/index.ts";
import { createInbox } from "../db/inbox.ts";
import { getWebhookSecretByRoutine, hashSecretForStorage, upsertWebhookSecret } from "../db/routine-step-runs.ts";
import { createGraphRoutine, deleteRoutine, getGraphRun, getRoutine, listRuns, updateGraphRoutine } from "../db/routines.ts";
import { buildHooksRouter, REPLAY_WINDOW_SECS } from "../routes-hooks.ts";
import { buildRoutinesRouter } from "../routes-routines.ts";
import { RoutinesRunner } from "../routines-runner.ts";

const SECRET = "isolated-native-hook-secret";
const BODY = '{ "message": "native", "nested": [false, 0, null, ""] }';
let home = "";
let runner: RoutinesRunner | undefined;
let oldHome: string | undefined;
let oldDb: string | undefined;
const restore: Array<() => void> = [];

afterEach(async () => {
	for (const undo of restore.splice(0)) undo();
	await runner?.dispose();
	closeDb();
	if (home) fs.rmSync(home, { recursive: true, force: true });
	if (oldHome === undefined) delete process.env.NPI_DECK_HOME; else process.env.NPI_DECK_HOME = oldHome;
	if (oldDb === undefined) delete process.env.NPI_DECK_DB_PATH; else process.env.NPI_DECK_DB_PATH = oldDb;
	home = "";
	runner = undefined;
});

function setup() {
	const scratch = path.join(os.homedir(), ".cache/npi-canary/neodeck-pool");
	fs.mkdirSync(scratch, { recursive: true });
	home = fs.mkdtempSync(path.join(scratch, "trigger-admission-"));
	oldHome = process.env.NPI_DECK_HOME;
	oldDb = process.env.NPI_DECK_DB_PATH;
	process.env.NPI_DECK_HOME = home;
	process.env.NPI_DECK_DB_PATH = path.join(home, "deck.db");
	openDb({ path: process.env.NPI_DECK_DB_PATH });
	const run = runner = new RoutinesRunner();
	const received: GraphValue[] = [];
	run.graphRegistry.register({
		definition: { type: "test.capture-trigger", label: "Capture trigger", kind: "operation", inputs: [{ id: "in", type: "object", multiple: true }], outputs: [] },
		execute: ({ activation }) => { received.push(structuredClone(activation.event)); return []; },
	});
	return { run, received, routes: buildRoutinesRouter(run), hooks: buildHooksRouter(run) };
}

function sourceGraph(config: RoutineGraph["nodes"][number]["config"]): RoutineGraph {
	return {
		version: 2,
		nodes: [{ id: "source", type: "event.source", config }, { id: "capture", type: "test.capture-trigger", config: {} }],
		edges: [{ id: "capture", from: { nodeId: "source", port: "event" }, to: { nodeId: "capture", port: "in" } }],
	};
}

function fixture(enabled = true) {
	const state = setup();
	const hookPath = `/hooks/native-${crypto.randomUUID()}`;
	const graph = sourceGraph({ eventType: "webhook", webhook: { path: hookPath, secret_env: "SENDER_SECRET" } });
	const routine = createGraphRoutine({ name: "native webhook", graph, enabled }, state.run.graphRegistry);
	expect(upsertWebhookSecret({ routineId: routine.id, path: hookPath, secret: SECRET })).toBe(true);
	const deliver = (raw = BODY, headers = signed(raw), body: string | ReadableStream<Uint8Array> = raw) => state.hooks.request(hookPath, {
		method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half",
	} as RequestInit);
	return { ...state, hookPath, graph, routine, deliver };
}

function request(body: unknown, method = "POST"): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
function signed(raw: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> {
	return { "x-routine-timestamp": String(timestamp), "x-routine-signature": `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")}` };
}
async function settle(run: RoutinesRunner): Promise<void> {
	for (let attempt = 0; run.busy && attempt < 1000; attempt++) await Bun.sleep(1);
	expect(run.busy).toBe(false);
}
function legacyCredentials(routineId: string): void {
	getDb().query("UPDATE routine_webhook_secrets SET signing_key = NULL, accept_bare_secret = 1, created_at = ?, last_used_at = ?, last_bare_secret_at = ? WHERE routine_id = ?")
		.run("2025-01-01T00:00:00.000Z", null, null, routineId);
}
function gatedBody(raw = BODY) {
	let start!: () => void;
	let release!: () => void;
	const reading = new Promise<void>(resolve => { start = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	const body = new ReadableStream<Uint8Array>({ async pull(controller) {
		start(); await gate; controller.enqueue(new TextEncoder().encode(raw)); controller.close();
	} });
	return { body, reading, release };
}

test("native authoring ensures, moves and removes a registration without rotating credentials on save", async () => {
	const { run, routes } = setup();
	const graph = sourceGraph({ eventType: "webhook", webhook: { path: "/hooks/authored", secret_env: "SENDER_KEY" } });
	const created = await routes.request("/routines", request({ name: "authored native hook", graph }));
	expect(created.status).toBe(201);
	const routine = await created.json() as Routine;
	expect(getWebhookSecretByRoutine(routine.id)).toMatchObject({ path: "/hooks/authored", accept_bare_secret: 0 });
	upsertWebhookSecret({ routineId: routine.id, path: "/hooks/authored", secret: SECRET });
	legacyCredentials(routine.id);
	const before = getWebhookSecretByRoutine(routine.id)!;
	expect((await routes.request(`/routines/${routine.id}`, request({ graph }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual(before);
	graph.nodes[0]!.config.webhook = { path: "/hooks/authored-moved", secret_env: "SENDER_KEY" };
	expect((await routes.request(`/routines/${routine.id}`, request({ graph }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual({ ...before, path: "/hooks/authored-moved" });
	expect((await routes.request(`/routines/${routine.id}`, request({ name: "renamed" }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual({ ...before, path: "/hooks/authored-moved" });
	expect((await routes.request(`/routines/${routine.id}`, request({ graph: sourceGraph({ eventType: "manual" }) }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toBeUndefined();
	expect(run.busy).toBe(false);
});

test("signed native webhook admission selects its registered source and preserves exact payload bytes and values", async () => {
	const { run, routine, graph, deliver, received } = fixture();
	graph.nodes.push({ id: "unregistered", type: "event.source", config: { eventType: "webhook" } });
	graph.edges.push({ id: "unregistered", from: { nodeId: "unregistered", port: "event" }, to: { nodeId: "capture", port: "in" } });
	updateGraphRoutine(routine.id, { graph }, run.graphRegistry);
	expect((await deliver()).status).toBe(202);
	await settle(run);
	expect(received).toEqual([JSON.parse(BODY)]);
	const trace = getGraphRun(listRuns(routine.id)[0]!.id)!;
	expect(trace).toMatchObject({ status: "success", activation: { sourceNodeId: "source", event: JSON.parse(BODY) } });
	expect(trace.nodeRuns.find(node => node.nodeId === "unregistered")?.status).toBe("skipped");
	expect(getWebhookSecretByRoutine(routine.id)?.last_used_at).not.toBeNull();
});

test("signed native webhook arrays remain the legacy trigger value, not a new body wrapper", async () => {
	const { run, routine, received, deliver } = fixture();
	const raw = '[false, 0, null, "", { "tail": [1, 2] }]';
	expect((await deliver(raw)).status).toBe(202);
	await settle(run);
	expect(received).toEqual([JSON.parse(raw)]);
	expect(getGraphRun(listRuns(routine.id)[0]!.id)).toMatchObject({ status: "success", activation: { event: JSON.parse(raw) } });
});

test("native credentials retain hash-only bare-secret upgrade, redacted status, permanent refusal and explicit rotation", async () => {
	const { run, routine, graph, routes, deliver, received } = fixture();
	legacyCredentials(routine.id);
	const before = getWebhookSecretByRoutine(routine.id)!;
	expect((await routes.request(`/routines/${routine.id}`, request({ graph }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual(before);
	const status = await routes.request(`/routines/${routine.id}/webhook`);
	const text = await status.text();
	expect(JSON.parse(text)).toMatchObject({ acceptsBareSecret: true, signingKeyStored: false });
	expect(text).not.toContain(SECRET);
	expect(text).not.toContain(hashSecretForStorage(SECRET));
	expect((await deliver()).status).toBe(401);
	expect((await deliver(BODY, { "x-routine-signature": SECRET })).status).toBe(202);
	await settle(run);
	expect(getWebhookSecretByRoutine(routine.id)).toMatchObject({ signing_key: SECRET, accept_bare_secret: 1, created_at: before.created_at });
	expect((await routes.request(`/routines/${routine.id}/webhook`, request({ acceptBareSecret: false }, "PATCH"))).status).toBe(200);
	expect((await routes.request(`/routines/${routine.id}/webhook`, request({ acceptBareSecret: true }, "PATCH"))).status).toBe(409);
	expect((await deliver(BODY, { "x-routine-signature": SECRET })).status).toBe(401);
	expect((await deliver()).status).toBe(202);
	await settle(run);
	const rotated = await routes.request(`/routines/${routine.id}/webhook-secret/rotate`, { method: "POST" });
	expect(rotated.status).toBe(200);
	const { secret } = await rotated.json() as { secret: string };
	expect(secret).not.toBe(SECRET);
	expect((await deliver()).status).toBe(401);
	expect((await deliver(BODY, signed(BODY, secret))).status).toBe(202);
	await settle(run);
	expect(received).toHaveLength(3);
});

test("native hook admission rejects wrong bytes, missing timestamps and out-of-window signatures", async () => {
	const { received, deliver, routine } = fixture();
	expect((await deliver(`${BODY} `, signed(BODY))).status).toBe(401);
	expect((await deliver(BODY, { "x-routine-signature": signed(BODY)["x-routine-signature"]! })).status).toBe(401);
	for (const offset of [-REPLAY_WINDOW_SECS - 1, REPLAY_WINDOW_SECS + 1]) {
		expect((await deliver(BODY, signed(BODY, SECRET, Math.floor(Date.now() / 1000) + offset))).status).toBe(401);
	}
	expect(received).toEqual([]);
	expect(listRuns(routine.id).every(run => run.abortReason === "signature_invalid")).toBe(true);
	expect(getWebhookSecretByRoutine(routine.id)?.last_used_at).toBeNull();
});

for (const mutation of ["rotate", "refuse", "disable", "move", "remove", "delete", "expire"] as const) {
	test(`native hook rechecks ${mutation} during a concurrent body upload`, async () => {
		const { run, routes, routine, graph, received, deliver } = fixture();
		if (mutation === "refuse") legacyCredentials(routine.id);
		const gate = gatedBody();
		const timestamp = Math.floor(Date.now() / 1000);
		const pending = deliver(BODY, mutation === "refuse" ? { "x-routine-signature": SECRET } : signed(BODY, SECRET, timestamp), gate.body);
		await gate.reading;
		if (mutation === "rotate") expect((await routes.request(`/routines/${routine.id}/webhook-secret/rotate`, { method: "POST" })).status).toBe(200);
		if (mutation === "refuse") expect((await routes.request(`/routines/${routine.id}/webhook`, request({ acceptBareSecret: false }, "PATCH"))).status).toBe(200);
		if (mutation === "disable") updateGraphRoutine(routine.id, { enabled: false }, run.graphRegistry);
		if (mutation === "move" || mutation === "remove") {
			graph.nodes[0]!.config = mutation === "move" ? { eventType: "webhook", webhook: { path: "/hooks/moved-during-upload" } } : { eventType: "manual" };
			expect((await routes.request(`/routines/${routine.id}`, request({ graph }, "PATCH"))).status).toBe(200);
		}
		if (mutation === "delete") expect(deleteRoutine(routine.id)).toBe(true);
		if (mutation === "expire") {
			const clock = spyOn(Date, "now").mockReturnValue((timestamp + REPLAY_WINDOW_SECS + 1) * 1000);
			restore.push(() => clock.mockRestore());
		}
		gate.release();
		const response = await pending;
		expect(response.status).toBe(mutation === "disable" ? 409 : mutation === "move" || mutation === "remove" || mutation === "delete" ? 404 : 401);
		expect(received).toEqual([]);
		expect(getWebhookSecretByRoutine(routine.id)?.last_used_at ?? null).toBeNull();
	});
}

test("disabled native hooks authenticate before returning their state", async () => {
	const { deliver, routine, received } = fixture(false);
	expect((await deliver(BODY, signed(BODY, "wrong"))).status).toBe(401);
	expect((await deliver()).status).toBe(409);
	expect(received).toEqual([]);
	expect(listRuns(routine.id)).toHaveLength(1);
});

test("native manual schemas are retained as declarations and do not restrict legacy manual admission", async () => {
	const { run, routes, received } = setup();
	const manualTriggers = [{ params_schema: false }, { params_schema: { type: "object", required: ["missing"] } }, { params_schema: null }];
	const graph = sourceGraph({ eventType: "manual", manualTriggers });
	const created = await routes.request("/routines", request({ name: "manual metadata", graph, enabled: false }));
	expect(created.status).toBe(201);
	const routine = await created.json() as Routine;
	expect(getRoutine(routine.id)?.graph?.nodes[0]!.config.manualTriggers).toEqual(manualTriggers);
	expect((await routes.request(`/routines/${routine.id}/run`, request({ unrestricted: [false, 0, null] }))).status).toBe(202);
	await settle(run);
	expect(received).toEqual([{ unrestricted: [false, 0, null] }]);
	expect(getGraphRun(listRuns(routine.id)[0]!.id)?.status).toBe("success");
});

test("legacy event declarations preserve generic fire admission without inventing source subscriptions or duplicate runs", async () => {
	const { run, received } = setup();
	const eventTriggers = [{ source: "deck_inbox", type: "card_added", filter: "false" }, { source: "telegram", type: "message", filter: "throw new Error('not evaluated')" }];
	const graph = sourceGraph({ eventType: "event", eventTriggers });
	const routine = createGraphRoutine({ name: "generic legacy events", graph }, run.graphRegistry);
	run.start();
	createInbox({ title: "metadata is not an inbox subscription", kind: "capture" });
	await settle(run);
	expect(listRuns(routine.id)).toEqual([]);
	const payload = { source: "unmatched", type: "anything", exact: [false, 0, null] };
	await run.fire(routine.id, "event", payload);
	expect(received).toEqual([payload]);
	expect(listRuns(routine.id)).toHaveLength(1);
	expect(getRoutine(routine.id)?.graph?.nodes[0]!.config.eventTriggers).toEqual(eventTriggers);
	updateGraphRoutine(routine.id, { enabled: false }, run.graphRegistry);
	await run.fire(routine.id, "event", payload);
	expect(received).toHaveLength(1);
});

test("native source declarations reject ambiguous credentials and misplaced metadata", () => {
	const { run } = setup();
	const misplaced: RoutineGraph["nodes"][number]["config"][] = [
		{ eventType: "manual", webhook: { path: "/hooks/wrong-kind" } },
		{ eventType: "event", manualTriggers: [{}] },
		{ eventType: "manual", eventTriggers: [{ source: "telegram" }] },
	];
	for (const config of misplaced) expect(run.graphRegistry.validate(sourceGraph(config)).valid).toBe(false);
	const graph = sourceGraph({ eventType: "webhook", webhook: { path: "/hooks/first" } });
	graph.nodes.push({ id: "second", type: "event.source", config: { eventType: "webhook", webhook: { path: "/hooks/second" } } });
	expect(run.graphRegistry.validate(graph).valid).toBe(false);
});

test("native hook body parsing keeps legacy scalar, unparsable and text payloads", async () => {
	const { run, received, deliver, hooks, hookPath } = fixture();
	for (const raw of ["null", "false", "42", "\"scalar\"", "{invalid"]) {
		expect((await deliver(raw)).status).toBe(202);
		await settle(run);
	}
	const raw = "plain text\nwith original spacing";
	expect((await hooks.request(hookPath, { method: "POST", headers: { "content-type": "text/plain", ...signed(raw) }, body: raw })).status).toBe(202);
	await settle(run);
	expect(received).toEqual([{ body: null }, { body: false }, { body: 42 }, { body: "scalar" }, { body: "<unparsable>" }, { body: raw }]);
});

test("an untouched native orphan registration stays visible across metadata saves but cannot activate an unrelated source", async () => {
	const { run, routine, routes, received, deliver } = fixture();
	const before = getWebhookSecretByRoutine(routine.id)!;
	updateGraphRoutine(routine.id, { graph: sourceGraph({ eventType: "manual" }) }, run.graphRegistry);
	expect((await routes.request(`/routines/${routine.id}`, request({ description: "metadata only" }, "PATCH"))).status).toBe(200);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual(before);
	expect((await routes.request(`/routines/${routine.id}/webhook`)).status).toBe(200);
	expect((await deliver()).status).toBe(404);
	expect(received).toEqual([]);
	expect(listRuns(routine.id)).toEqual([]);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual(before);
});

test("native hook authoring refuses claimed paths before changing either definition or credential row", async () => {
	const { run, routes, routine, graph } = fixture();
	const ownerGraph = sourceGraph({ eventType: "webhook", webhook: { path: "/hooks/already-claimed" } });
	const owner = createGraphRoutine({ name: "hook path owner", graph: ownerGraph }, run.graphRegistry);
	upsertWebhookSecret({ routineId: owner.id, path: "/hooks/already-claimed", secret: "owner-secret" });
	const original = getWebhookSecretByRoutine(routine.id)!;
	const owned = getWebhookSecretByRoutine(owner.id)!;
	expect((await routes.request("/routines", request({ name: "conflicting native hook", graph: ownerGraph }))).status).toBe(409);
	expect((await routes.request(`/routines/${routine.id}`, request({ graph: ownerGraph }, "PATCH"))).status).toBe(409);
	expect(getRoutine(routine.id)?.graph).toEqual(graph);
	expect(getWebhookSecretByRoutine(routine.id)).toEqual(original);
	expect(getWebhookSecretByRoutine(owner.id)).toEqual(owned);
});
