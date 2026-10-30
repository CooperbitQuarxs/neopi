import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { graphToToml, NODE_TYPES, type StudioGraph, type StudioNode, type StudioRun } from "@npi-deck/protocol";
import { closeDb, openDb } from "./db/index.ts";
import { listTasks } from "./db/tasks.ts";
import { createRoutine } from "./db/routines.ts";
import { buildGraphsRouter } from "./routes-graphs.ts";

const scratch = join(homedir(), ".cache/npi-canary/neodeck-pool/StudioEngine/tests");
let directory: string;
let app: ReturnType<typeof buildGraphsRouter>;
beforeEach(() => { mkdirSync(scratch, { recursive: true }); directory = mkdtempSync(join(scratch, "graphs-")); openDb({ path: join(directory, "deck.db") }); app = buildGraphsRouter(); });
afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); });
const json = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const node = (id: string, type: string, config: Record<string, unknown> = {}): StudioNode => ({ id, type, config, position: { x: 0, y: 0 } });
const edge = (from: string, port: string, to: string, input = "input") => ({ id: `${from}-${to}`, from: { node: from, port }, to: { node: to, port: input } });
async function create(kind = "pipeline"): Promise<StudioGraph> { const response = await app.request("/graphs", json("POST", { kind, name: "Graph" })); expect(response.status).toBe(201); return response.json() as Promise<StudioGraph>; }
async function save(graph: StudioGraph): Promise<StudioGraph> { const response = await app.request(`/graphs/${graph.id}`, json("PUT", graph)); expect(response.status).toBe(200); return response.json() as Promise<StudioGraph>; }
async function run(graph: StudioGraph, body?: unknown): Promise<StudioRun> { const response = await app.request(`/graphs/${graph.id}/run`, body ? json("POST", body) : { method: "POST" }); expect(response.status).toBe(201); return response.json() as Promise<StudioRun>; }

describe("Studio graph HTTP documents", () => {
 test("persists CRUD and TOML across reopening the database", async () => {
  let graph = await create(); graph.nodes = [node("start", "event.manual", { sample: "hello" })]; graph.settings = { nested: { flags: [{ key: "value", enabled: true }] } }; graph = await save(graph);
  const sourceResponse = await app.request(`/graphs/${graph.id}?format=toml`); expect(sourceResponse.headers.get("content-type")).toContain("text/toml"); const source = await sourceResponse.text();
  const updated = await app.request(`/graphs/${graph.id}`, { method: "PUT", headers: { "content-type": "text/toml; charset=utf-8" }, body: source.replace('name = "Graph"', 'name = "Persisted"') }); expect(updated.status).toBe(200);
  closeDb(); openDb({ path: join(directory, "deck.db") }); app = buildGraphsRouter();
  const loaded = await (await app.request(`/graphs/${graph.id}`)).json() as StudioGraph; expect(loaded.name).toBe("Persisted"); expect(loaded.settings).toEqual(graph.settings);
  const list = await (await app.request("/graphs")).json() as { graphs: { kind: string }[] }; expect(list.graphs.filter(graph => graph.kind === "pipeline")).toHaveLength(1); expect(list.graphs.some(graph => graph.kind === "map")).toBe(true);
  expect((await app.request(`/graphs/${graph.id}`, { method: "DELETE" })).status).toBe(200); expect((await app.request(`/graphs/${graph.id}`)).status).toBe(404);
 });
 test("accepts complete browser documents without changing their ids or overwriting existing graphs", async () => {
  const graph = { ...await create(), id: "old-browser-graph", nodes: [node("start", "event.manual")] };
  expect((await app.request("/graphs", json("POST", graph))).status).toBe(201);
  expect((await app.request("/graphs", json("POST", { ...graph, name: "Overwrite" }))).status).toBe(409);
  expect(((await (await app.request(`/graphs/${graph.id}`)).json()) as StudioGraph).name).toBe("Graph");
 });
 test("refuses router policy persistence and flow duplication", async () => {
  for (const kind of ["router", "flow", "map"]) expect((await app.request("/graphs", json("POST", { kind, name: "Pinned" }))).status).toBe(400);
  expect(((await (await app.request("/graphs")).json()) as { graphs: { kind: string }[] }).graphs.map(graph => graph.kind)).toEqual(["map"]);
 });
 test("mirrors routines and the map without inventing a successful last run", async () => {
  const routine = createRoutine({ name: "An existing flow", cron: "0 0 * * *", actionKind: "bash", actionBody: "exit 0", enabled: false });
  const list = await (await app.request("/graphs")).json() as { graphs: { id: string; kind: string; lastRun?: unknown }[] };
  expect(list.graphs.find(graph => graph.id === routine.id)?.kind).toBe("flow");
  expect(list.graphs.find(graph => graph.id === routine.id)?.lastRun).toBeUndefined();
  expect(list.graphs.some(graph => graph.id === "map")).toBe(true);
 });
 test("serves the shared expanded catalog before the dynamic id route", async () => {
  const catalog = await (await app.request("/graphs/node-types?kind=pipeline")).json() as { nodeTypes: { kind: string; type: string; execution: string }[] };
  expect(NODE_TYPES.length).toBeGreaterThan(60); expect(catalog.nodeTypes.every(node => node.kind === "pipeline")).toBe(true); expect(catalog.nodeTypes.find(node => node.type === "agent.spawn")?.execution).toBe("preview");
  expect((await app.request("/graphs/node-types?kind=nope")).status).toBe(400);
 });
 test("rejects malformed config, duplicate edges, cycles and incompatible ports without changing the saved document", async () => {
  const graph = await create();
  for (const nodes of [[node("start", "no.such.node")], [node("a", "logic.delay", { seconds: "wrong" })], [node("a", "event.manual"), node("a", "event.manual")]]) expect((await app.request(`/graphs/${graph.id}`, json("PUT", { ...graph, nodes }))).status).toBe(400);
  const nodes = [node("a", "transform.pick"), node("b", "transform.pick")];
  expect((await app.request(`/graphs/${graph.id}`, json("PUT", { ...graph, nodes, edges: [edge("a", "output", "b"), edge("b", "output", "a")] }))).status).toBe(400);
  expect((await app.request(`/graphs/${graph.id}`, json("PUT", { ...graph, settings: { lost: null } }))).status).toBe(400);
  expect(((await (await app.request(`/graphs/${graph.id}`)).json()) as StudioGraph).nodes).toHaveLength(0);
 });
 test("accepts full server TOML syntax and rejects immutable id edits", async () => {
  const graph = await create(); const source = graphToToml(graph).replace('description = ""', 'description = """\nMultiple lines\nare valid TOML\n"""');
  expect((await app.request(`/graphs/${graph.id}`, { method: "PUT", headers: { "content-type": "text/toml" }, body: source })).status).toBe(200);
  expect((await app.request(`/graphs/${graph.id}`, { method: "PUT", headers: { "content-type": "text/toml" }, body: source.replace(graph.id, "wrong") })).status).toBe(400);
 });
});

describe("Studio graph runs", () => {
 test("default preview never invokes inference or output actions, and reports no invented cost", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual", { sample: "input" }), node("infer", "infer.request", { model: "@default" }), node("out", "out.create_card")]; graph.edges = [edge("start", "event", "infer"), edge("infer", "text", "out")]; await save(graph);
  const count = listTasks().length, result = await run(graph);
  expect(listTasks()).toHaveLength(count); expect(result.mode).toBe("preview"); expect(result.costUsd).toBeUndefined(); expect(result.nodes.find(node => node.nodeId === "infer")?.status).toBe("skipped"); expect(result.nodes.find(node => node.nodeId === "out")?.status).toBe("skipped");
  expect(((await (await app.request(`/graphs/${graph.id}`)).json()) as StudioGraph).lastRun).toEqual({ at: result.startedAt, ok: true });
 });
 test("previews disconnected draft nodes as skipped without dispatching work", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("out", "out.create_card", { name: "File a card" }), node("infer", "infer.request", { name: "Review" })]; await save(graph);
  const count = listTasks().length, result = await run(graph);
  expect(result.ok).toBe(true); expect(result.nodes).toHaveLength(3); expect(result.nodes.find(node => node.nodeId === "start")?.status).toBe("ok");
  for (const id of ["out", "infer"]) { const record = result.nodes.find(node => node.nodeId === id); expect(record?.status).toBe("skipped"); expect(record?.note).toBeDefined(); expect(record?.output).toBeUndefined(); }
  expect(listTasks()).toHaveLength(count);
 });
 test("previews a source-free draft without treating an unconnected action as a trigger", async () => {
  const graph = await create(); graph.nodes = [node("out", "out.create_card")]; await save(graph);
  const count = listTasks().length, result = await run(graph);
  expect(result.ok).toBe(true); expect(result.nodes[0]?.status).toBe("skipped"); expect(listTasks()).toHaveLength(count);
 });
 test("returns node-addressed execution problems before connected actions run", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("out", "out.create_card"), node("loose", "transform.template", { name: "Detached formatter" })]; graph.edges = [edge("start", "event", "out")]; await save(graph);
  const count = listTasks().length;
  const response = await app.request(`/graphs/${graph.id}/run`, json("POST", { mode: "execute", input: { title: "Must not be filed" } }));
  expect(response.status).toBe(400); const body = await response.json() as { problems: { nodeId: string; message: string }[] };
  expect(body.problems.map(problem => problem.nodeId)).toEqual(["loose"]); expect(body.problems[0]?.message).toContain("Detached formatter"); expect(listTasks()).toHaveLength(count);
 });
 test("executes real local transforms and respects absent branches", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("pick", "route.switch", { labels: "yes,no", path: "decision" }), node("yes", "transform.template", { template: "Approved {{input.name}}" }), node("no", "transform.template", { template: "Rejected" })]; graph.edges = [edge("start", "event", "pick"), edge("pick", "yes", "yes"), edge("pick", "no", "no")]; await save(graph);
  const result = await run(graph, { input: { decision: "yes", name: "Captain" } });
  expect(result.nodes.find(node => node.nodeId === "yes")?.output).toEqual([{ port: "text", value: "Approved Captain" }]); expect(result.nodes.find(node => node.nodeId === "no")?.status).toBe("skipped");
 });
 test("only explicit execute creates cards, preserving object input", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("out", "out.create_card")]; graph.edges = [edge("start", "event", "out")]; await save(graph);
  const count = listTasks().length; const input = { title: "Created through Studio", body: "Actual execution" };
  await run(graph, { input }); expect(listTasks()).toHaveLength(count);
  const result = await run(graph, { mode: "execute", input }); expect(result.ok).toBe(true); expect(listTasks()).toHaveLength(count + 1); expect(listTasks().some(card => card.title === input.title)).toBe(true);
 });
 test("rejects unsupported execution before any supported action can run", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("out", "out.create_card"), node("agent", "agent.spawn")]; graph.edges = [edge("start", "event", "out"), edge("start", "event", "agent")]; await save(graph);
  const count = listTasks().length; const result = await app.request(`/graphs/${graph.id}/run`, json("POST", { mode: "execute", input: { title: "Must not be filed" } })); expect(result.status).toBe(409); expect(listTasks()).toHaveLength(count);
 });
 test("records real failures and retains immutable, newest-first history after definition edits and reopen", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("fail", "logic.fail", { message: "Expected failure" })]; graph.edges = [edge("start", "event", "fail")]; await save(graph);
  const first = await run(graph); expect(first.ok).toBe(false); expect(first.nodes.find(node => node.nodeId === "fail")?.note).toBe("Expected failure");
  graph.nodes = [node("new", "event.manual")]; graph.edges = []; await save(graph); const second = await run(graph);
  closeDb(); openDb({ path: join(directory, "deck.db") }); app = buildGraphsRouter();
  const history = await (await app.request(`/graphs/${graph.id}/runs`)).json() as { runs: StudioRun[] }; expect(history.runs.map(run => run.id)).toEqual([second.id, first.id]); expect(history.runs[1]!.nodes.some(node => node.nodeId === "fail")).toBe(true);
 });
 test("requires explicit booleans for conditions instead of truthy coercion", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("condition", "route.if", { condition: "context.input" })]; graph.edges = [edge("start", "event", "condition")]; await save(graph);
  expect((await run(graph, { input: "false" })).ok).toBe(false); expect((await run(graph, { input: true })).ok).toBe(true);
 });
 test("admits only one execution when simultaneous request bodies finish reading", async () => {
  const graph = await create(); graph.nodes = [node("start", "event.manual"), node("wait", "logic.delay", { seconds: 0.03 })]; graph.edges = [edge("start", "event", "wait")]; await save(graph);
  const responses = await Promise.all([app.request(`/graphs/${graph.id}/run`, json("POST", { mode: "execute" })), app.request(`/graphs/${graph.id}/run`, json("POST", { mode: "execute" }))]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
 });
 test("rejects malformed run modes and empty runs", async () => {
  const graph = await create(); expect((await app.request(`/graphs/${graph.id}/run`, json("POST", { mode: "automatic" }))).status).toBe(400); expect((await app.request(`/graphs/${graph.id}/run`, { method: "POST" })).status).toBe(400);
 });
});

test("Studio exposes and executes native numeric operations and exact gate branches", async () => {
	const graph = await create();
	graph.nodes = [node("start", "event.manual"), node("left", "operation.number", { path: '["result","value","left"]' }), node("right", "operation.number", { path: '["result","value","right"]' }), node("math", "operation.arithmetic", { operator: "multiply" }), node("gate", "gate.compare", { path: '["result","value"]', operator: "eq", right: "12" }), node("yes", "transform.template", { template: "Exact {{input}}" }), node("no", "logic.fail")];
	graph.edges = [edge("start", "event", "left"), edge("start", "event", "right"), edge("left", "value", "math", "left"), edge("right", "value", "math", "right"), edge("math", "value", "gate"), edge("gate", "true", "yes"), edge("gate", "false", "no")];
	await save(graph);
	const result = await run(graph, { input: { left: 3, right: 4 } });
	expect(result.ok).toBe(true);
	expect(result.nodes.find(node => node.nodeId === "math")?.output).toEqual([{ port: "value", value: 12 }]);
	expect(result.nodes.find(node => node.nodeId === "yes")?.output).toEqual([{ port: "text", value: "Exact 12" }]);
	expect(result.nodes.find(node => node.nodeId === "no")?.status).toBe("skipped");
});

test("Studio iteration preview is write-free and explicit execution gives each pass a separate action identity", async () => {
	const graph = await create();
	const body = { version: 2, nodes: [
		{ id: "item", type: "iteration.input", config: { eventType: "iteration" } },
		{ id: "card", type: "action.create-card", config: { request: { title: { $from: { nodeId: "item", path: ["result", "item"] } }, body: "isolated iteration" } } },
	], edges: [{ id: "item-card", from: { nodeId: "item", port: "item" }, to: { nodeId: "card", port: "in" } }] };
	graph.nodes = [node("start", "event.manual"), node("loop", "iteration.each", { path: '["result","value"]', maxIterations: 2, body: JSON.stringify(body) })];
	graph.edges = [edge("start", "event", "loop")];
	await save(graph);
	const count = listTasks().length;
	const preview = await run(graph, { input: ["first pass", "second pass"] });
	expect(preview.ok).toBe(true);
	expect(preview.nodes.find(node => node.nodeId === "loop")?.output).toEqual([{ port: "completed", value: { count: 2, completed: true } }]);
	expect(listTasks()).toHaveLength(count);
	const executed = await run(graph, { mode: "execute", input: ["first pass", "second pass"] });
	expect(executed.ok).toBe(true);
	expect(listTasks()).toHaveLength(count + 2);
	expect(listTasks().filter(card => ["first pass", "second pass"].includes(card.title))).toHaveLength(2);
});
