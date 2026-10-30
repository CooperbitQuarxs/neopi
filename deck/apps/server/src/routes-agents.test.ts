import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import type { AgentInstance } from "@npi-deck/protocol";
import type { AgentBridge } from "./bridge/types.ts";
import { closeDb, openDb } from "./db/index.ts";
import { buildAgentsRouter } from "./routes-agents.ts";

const scratch = path.join(process.env.HOME!, ".cache/npi-canary/neodeck-pool/AgentsBackend/tests");
let dir: string | undefined;
afterEach(() => { closeDb(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
function boot() {
	mkdirSync(scratch, { recursive: true }); dir = mkdtempSync(path.join(scratch, "routes-"));
	openDb({ path: path.join(dir, "deck.db") });
	const actions: string[] = [];
	const rows: AgentInstance[] = [
		{ id: "root", templateId: null, sessionId: "thread-a", parentInstanceId: null, label: "Main", status: "running", actions: { steer: true, cancel: true, enter: true, setThinking: false, setFast: false } },
		{ id: "child", templateId: null, sessionId: "thread-a", parentInstanceId: "root", label: "Research", status: "running", actions: { steer: true, cancel: true, enter: true, setThinking: false, setFast: false } },
		{ id: "foreign", templateId: null, sessionId: "thread-b", parentInstanceId: "other-root", label: "Other", status: "running", actions: { steer: true, cancel: true, enter: true, setThinking: false, setFast: false } },
	];
	const bridge = {
		agentInstances: () => rows,
		getSession: (id: string) => ["thread-a", "thread-b"].includes(id) ? { isStreamingNow: () => true, abort: async () => { actions.push(`abort:${id}`); }, prompt: async (text: string) => { actions.push(`prompt:${id}:${text}`); return true; }, setModel: async () => { actions.push("model"); } } : undefined,
		abortSubagent: async (sid: string, id: string) => { actions.push(`cancel:${sid}:${id}`); },
		steerSubagent: async (sid: string, id: string, text: string) => { actions.push(`steer:${sid}:${id}:${text}`); },
		bumpActivity: () => {},
	} as unknown as AgentBridge;
	return { app: buildAgentsRouter(bridge), actions, rows };
}
const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe("agent templates", () => {
	test("persists authored configuration across database reopen without seeding native definitions", async () => {
		const { app } = boot();
		expect(((await (await app.request("/agents/templates")).json()) as { templates: unknown[] }).templates).toEqual([]);
		const body = { id: "research", name: "Research", model: "@default:high", preset: "advisor", tools: ["read"], systemPrompt: "Read the source.", source: { format: "agent-md", path: "/invented" } };
		const created = await app.request("/agents/templates", json("POST", body));
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({ id: "research", source: { format: "deck" }, instanceCount: 0, model: "@default:high" });
		expect((await app.request("/agents/templates", json("POST", body))).status).toBe(409);
		closeDb(); openDb({ path: path.join(dir!, "deck.db") });
		const saved = (await (await app.request("/agents/templates/research")).json()) as Record<string, unknown>;
		expect(saved.tools).toEqual(["read"]); expect(saved.systemPrompt).toBe("Read the source.");
		expect(saved.status).toBeUndefined();
		expect((await app.request("/agents/templates/research", json("PUT", { name: "Renamed", tools: 5 }))).status).toBe(400);
		expect((await app.request("/agents/templates/research", json("PUT", { name: "Renamed" }))).status).toBe(200);
		expect((await app.request("/agents/templates/research", { method: "DELETE" })).status).toBe(200);
		expect((await app.request("/agents/templates/research")).status).toBe(404);
	});
	test("rejects malformed definitions and JSON before writing", async () => {
		const { app } = boot();
		for (const body of [null, [], { id: "../escape", name: "Escape" }, { id: "empty", name: " " }, { id: "bad", name: "Bad", model: false }]) {
			expect((await app.request("/agents/templates", json("POST", body))).status).toBe(400);
		}
		expect((await app.request("/agents/templates", { method: "POST", body: "{" })).status).toBe(400);
		expect(((await (await app.request("/agents/templates")).json()) as { templates: unknown[] }).templates).toEqual([]);
	});
});
describe("native instances", () => {
	test("lists all live roots but scopes thread actions to their owner", async () => {
		const { app, actions } = boot();
		expect(((await (await app.request("/agents/instances")).json()) as { instances: AgentInstance[] }).instances).toHaveLength(3);
		expect(((await (await app.request("/threads/thread-a/agents")).json()) as { agents: AgentInstance[] }).agents.map(a => a.id)).toEqual(["root", "child"]);
		expect((await app.request("/threads/thread-a/agents/foreign", { method: "DELETE" })).status).toBe(404);
		expect(actions).toEqual([]);
		expect((await app.request("/threads/thread-a/agents/child", { method: "DELETE" })).status).toBe(200);
		expect((await app.request("/agents/instances/root/cancel", { method: "POST" })).status).toBe(200);
		expect((await app.request("/agents/instances/child/steer", json("POST", { text: "Inspect this" }))).status).toBe(200);
		expect(actions).toEqual(["cancel:thread-a:child", "abort:thread-a", "steer:thread-a:child:Inspect this"]);
	});
	test("does not simulate forbidden runtime operations or judge interventions", async () => {
		const { app, actions, rows } = boot(); rows[1]!.actions.steer = false;
		expect((await app.request("/agents/instances/child/steer", json("POST", { text: "No" }))).status).toBe(409);
		expect((await app.request("/threads/thread-a/send", json("POST", { text: "All", to: "all" }))).status).toBe(501);
		expect((await app.request("/agents", json("POST", { template: "research" }))).status).toBe(501);
		expect((await app.request("/agents/instances/root", json("PATCH", { model: "provider/model", restrictions: [] }))).status).toBe(501);
		expect((await app.request("/judge", json("PUT", { paused: false }))).status).toBe(501);
		expect((await (await app.request("/judge/events?limit=5")).json())).toMatchObject({ events: [], available: false });
		expect((await app.request("/judge/events?limit=0")).status).toBe(400);
		expect((await app.request("/judge/events/x/undo", { method: "POST" })).status).toBe(501);
		expect(actions).toEqual([]);
	});
});
