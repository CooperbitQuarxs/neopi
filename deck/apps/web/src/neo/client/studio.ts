import { routinesApi } from "@/lib/routines-api";
import { compatible, graphFromToml, graphToToml, nodePorts, nodeType, type BuildableKind, type GraphKind, type GraphProblem, type GraphSummary, type StudioEdge, type StudioGraph, type StudioNode, type StudioRun, type StudioRunOptions } from "@npi-deck/protocol";
import { SOURCES } from "./source";

export type { GraphKind, BuildableKind, GraphSummary, StudioGraph, StudioNode, StudioEdge, StudioRun, StudioRunOptions, GraphProblem };
export class StudioRequestError extends Error {
 constructor(message: string, readonly problems: GraphProblem[] = []) { super(message); }
}
export interface StudioClient {
 list(): Promise<GraphSummary[]>; get(id: string): Promise<StudioGraph>; save(graph: StudioGraph): Promise<StudioGraph>; create(kind: BuildableKind, name: string): Promise<StudioGraph>; remove(id: string): Promise<void>; setEnabled(id: string, enabled: boolean): Promise<void>; run(id: string, options?: StudioRunOptions): Promise<StudioRun>; runs(id: string): Promise<StudioRun[]>;
 source(id: string): Promise<string>; saveSource(id: string, source: string): Promise<StudioGraph>;
}
export function graphProblems(graph: StudioGraph): GraphProblem[] {
 const problems: GraphProblem[] = [];
 if (!graph.name.trim()) problems.push({ message: "Give this graph a name." });
 if (!graph.nodes.length) problems.push({ message: "Add a node to start this graph." });
 const ids = new Set<string>();
 for (const node of graph.nodes) {
  if (nodeType(node.type)?.kind !== graph.kind) problems.push({ nodeId: node.id, message: `Unknown ${graph.kind} node: ${node.type}.` });
  if (ids.has(node.id)) problems.push({ nodeId: node.id, message: `Node id ${node.id} is repeated.` });
  ids.add(node.id);
 }
 for (const edge of graph.edges) {
  const source = graph.nodes.find(node => node.id === edge.from.node), target = graph.nodes.find(node => node.id === edge.to.node);
  const output = source && nodePorts(source).outputs.find(port => port.id === edge.from.port), input = target && nodePorts(target).inputs.find(port => port.id === edge.to.port);
  if (!output || !input) problems.push({ nodeId: source?.id ?? target?.id, message: "A connection points to a missing node or port. Remove it or restore the port." });
  else if (!compatible(output, input)) problems.push({ nodeId: target?.id, message: `Cannot connect ${output.type} to ${input.type}. Choose matching ports.` });
 }
 return problems;
}
const storageKey = "neodeck.studio.graphs.v1";
const migrationKey = "neodeck.studio.graphs.imported.v1";
function importedIds(): Set<string> { try { const value: unknown = JSON.parse(localStorage.getItem(migrationKey) ?? "[]"); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []); } catch { return new Set(); } }
function storedGraphs(): StudioGraph[] { try { const raw = localStorage.getItem(storageKey); const value: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value.filter(graph => graph && typeof graph === "object" && typeof graph.id === "string") as StudioGraph[] : []; } catch { return []; } }
const n = (id: string, type: string, x: number, config: Record<string, unknown>): StudioNode => ({ id, type, position: { x, y: 140 }, config });
const e = (from: string, to: string, port: string): StudioEdge => ({ id: `${from}-${to}`, from: { node: from, port }, to: { node: to, port: "request" } });
function router(id: string, name: string, models: string[]): StudioGraph {
 const stages = models.map((model, index) => n(`stage-${index}`, "router.stage", (index + 1) * 240, { name: model.split("/").at(-1), model, accounts: "all", draw: "alternate", perAccount: 5, cap: 15, per: "user", window: "week", effort: "" }));
 return { id, name, kind: "router", description: "Browser-local routing design. Does not change NeoProxy policy.", enabled: false, settings: {}, updatedAt: new Date().toISOString(), nodes: [n("entry", "router.entry", 0, { name: "Request", virtualModel: name }), ...stages, n("limit", "router.terminal", (stages.length + 1) * 240, { name: "Limit", kind: "limit", message: "This pool is exhausted.", model: "" })], edges: [e("entry", stages[0]!.id, "request"), ...stages.map((stage, index) => e(stage.id, stages[index + 1]?.id ?? "limit", "next"))] };
}
const saved = storedGraphs();
let browserGraphs = saved.length ? saved : [router("r_heavy", "neoproxy/heavy", ["neoproxy/codex/gpt-6-astra", "neoproxy/codex/gpt-6.1-sol"]), router("r_default", "neoproxy/default", ["neoproxy/anthropic/claude-sonnet-5-5", "neoproxy/codex/gpt-6-luna"])];
const browserRuns: StudioRun[] = [];
function persist(): void { try { localStorage.setItem(storageKey, JSON.stringify(browserGraphs)); } catch { /* Browser preview remains available in memory. */ } }
const preview: StudioClient = {
 async list() { return browserGraphs.map(graph => ({ id: graph.id, kind: graph.kind, name: graph.name, description: graph.description, enabled: graph.enabled, nodes: graph.nodes.length, ...(graph.lastRun ? { lastRun: graph.lastRun } : {}) })); },
 async get(id) { const graph = browserGraphs.find(graph => graph.id === id); if (!graph) throw new Error("Graph not found. Choose one from the list."); return structuredClone(graph); },
 async save(graph) { const updated = structuredClone({ ...graph, updatedAt: new Date().toISOString() }); browserGraphs = [...browserGraphs.filter(item => item.id !== graph.id), updated]; persist(); return structuredClone(updated); },
 async create(kind, name) { return this.save({ id: crypto.randomUUID(), kind, name, description: "", enabled: false, nodes: [], edges: [], settings: {}, updatedAt: new Date().toISOString() }); },
 async remove(id) { browserGraphs = browserGraphs.filter(graph => graph.id !== id); persist(); },
 async setEnabled(id, enabled) { await this.save({ ...await this.get(id), enabled }); },
 async run(id, options = {}) {
  if (options.mode === "execute") throw new Error("Router graphs are browser-local previews. NeoProxy owns routing policy; no requests were sent.");
  const graph = await this.get(id), problems = graphProblems(graph); if (problems.length) throw new Error(problems[0]!.message);
  const startedAt = new Date().toISOString();
  const run: StudioRun = { id: crypto.randomUUID(), graphId: id, startedAt, endedAt: startedAt, ok: true, trigger: "Manual preview", mode: "preview", nodes: graph.nodes.map(node => ({ nodeId: node.id, startedAt, endedAt: startedAt, status: "skipped", note: "Browser-local preview. No inference, quota check or output action was sent." })) };
  browserRuns.unshift(run); await this.save({ ...graph, lastRun: { at: startedAt, ok: true } }); return structuredClone(run);
 },
 async runs(id) { return structuredClone(browserRuns.filter(run => run.graphId === id)); },
 async source(id) { return graphToToml(await this.get(id)); },
 async saveSource(id, source) { return this.save(graphFromToml(source, await this.get(id))); },
};
async function response(path: string, init?: RequestInit): Promise<Response> {
 const result = await fetch(`/api/graphs${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
 if (!result.ok) {
  const body = await result.json().catch(() => ({})) as { error?: string; problems?: GraphProblem[]; unsupported?: { nodeId: string; type: string }[] };
  const details = body.problems?.map(problem => problem.message).join("; ") ?? body.unsupported?.map(node => `${node.type} (${node.nodeId})`).join(", ");
  throw new StudioRequestError(body.error ? `${body.error}${details && !body.error.includes(details) ? ` ${details}` : ""}` : `Graph request failed (${result.status}).`, body.problems);
 }
 return result;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> { return (await response(path, init)).json() as Promise<T>; }
const liveGraphs: StudioClient = {
 async list() { return (await request<{ graphs: GraphSummary[] }>("")).graphs; },
 get: id => request(`/${encodeURIComponent(id)}`),
 save: graph => request(`/${encodeURIComponent(graph.id)}`, { method: "PUT", body: JSON.stringify(graph) }),
 create: (kind, name) => request("", { method: "POST", body: JSON.stringify({ kind, name }) }),
 async remove(id) { await request(`/${encodeURIComponent(id)}`, { method: "DELETE" }); },
 async setEnabled(id, enabled) { await this.save({ ...await this.get(id), enabled }); },
 run: (id, options = {}) => request(`/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify(options) }),
 async runs(id) { return (await request<{ runs: StudioRun[] }>(`/${encodeURIComponent(id)}/runs`)).runs; },
 async source(id) { return (await response(`/${encodeURIComponent(id)}?format=toml`)).text(); },
 saveSource: (id, source) => request(`/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "text/toml" }, body: source }),
};
const graphClient = SOURCES.studioGraphs === "live" ? liveGraphs : preview;
let migration: Promise<void> | undefined;
function migrateBrowserGraphs(): Promise<void> {
 if (SOURCES.studioGraphs !== "live") return Promise.resolve();
 return migration ??= (async () => {
  const imported = importedIds();
  const existing = new Map((await liveGraphs.list()).map(graph => [graph.id, graph.kind]));
  const remember = (id: string): void => { imported.add(id); try { localStorage.setItem(migrationKey, JSON.stringify([...imported])); } catch { /* The untouched browser document remains the backup. */ } };
  for (const graph of saved.filter(graph => ["pipeline", "classifier", "boardflow"].includes(graph.kind))) {
   if (imported.has(graph.id)) continue;
   if (existing.has(graph.id)) {
    if (existing.get(graph.id) !== graph.kind) throw new Error(`Saved browser graph "${graph.name}" conflicts with another document id. Its browser copy is unchanged.`);
    remember(graph.id); continue;
   }
   const result = await fetch("/api/graphs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(graph) });
   if (!result.ok && result.status !== 409) {
    const body = await result.json().catch(() => ({})) as { error?: string };
    throw new Error(`Could not import saved browser graph "${graph.name}". Its browser copy is unchanged. ${body.error ?? ""}`);
   }
   if (result.status === 409 && (await liveGraphs.get(graph.id)).kind !== graph.kind) throw new Error(`Graph id conflict for "${graph.name}". Its browser copy is unchanged.`);
   remember(graph.id);
  }
 })().catch(error => { migration = undefined; throw error; });
}
function isRouter(id: string): boolean { return browserGraphs.some(graph => graph.id === id && graph.kind === "router"); }
const clientFor = (id: string): StudioClient => isRouter(id) ? preview : graphClient;
const live: StudioClient = {
 async list() {
  await migrateBrowserGraphs();
  const [authored, routers] = await Promise.all([graphClient.list(), preview.list()]);
  if (SOURCES.studioGraphs === "live") return [...authored, ...routers.filter(graph => graph.kind === "router")];
  const routineResult = await routinesApi.list();
  return [...routineResult.routines.map(routine => ({ id: routine.id, kind: "flow" as const, name: routine.name, description: routine.description, nodes: routine.graph?.nodes.length ?? 1, enabled: routine.enabled, ...(routine.lastRunAt ? { lastRun: { at: routine.lastRunAt } } : {}) })), ...authored, { id: "map", kind: "map" as const, name: "Knowledge map", description: "Every note and the links between them", nodes: 0, enabled: true }];
 },
 get: id => clientFor(id).get(id),
 save: graph => (graph.kind === "router" ? preview : graphClient).save(graph),
 create: (kind, name) => (kind === "router" ? preview : graphClient).create(kind, name),
 async setEnabled(id, enabled) { const list = await this.list(); if (list.find(graph => graph.id === id)?.kind === "flow") await routinesApi.update(id, { enabled }); else await clientFor(id).setEnabled(id, enabled); },
 async remove(id) { const list = await this.list(); if (list.find(graph => graph.id === id)?.kind === "flow") await routinesApi.remove(id); else await clientFor(id).remove(id); },
 async run(id, options = {}) {
  const list = await this.list(); if (list.find(graph => graph.id === id)?.kind !== "flow") return clientFor(id).run(id, options);
  const routine = await routinesApi.get(id);
  if (options.mode === "execute") await routinesApi.runNow(id, routine.specVersion === 2 ? { id: crypto.randomUUID() } : undefined);
  else {
   if (routine.specVersion !== 2) throw new Error("This legacy flow has no write-free preview. Choose Execute explicitly to run its actions.");
   const trace = await routinesApi.previewGraph(id);
   return { id: trace.id, graphId: id, startedAt: trace.startedAt, endedAt: trace.endedAt, ok: trace.status === "success", mode: "preview", trigger: "Manual preview", nodes: trace.nodeRuns.map(node => ({ nodeId: node.nodeId, startedAt: node.startedAt ?? trace.startedAt, endedAt: node.endedAt, status: node.status === "success" ? "ok" as const : node.status === "skipped" ? "skipped" as const : "failed" as const, note: node.error })) };
  }
  return { id: "queued", graphId: id, startedAt: new Date().toISOString(), ok: null, trigger: options.mode === "execute" ? "Manual" : "Manual preview", mode: options.mode ?? "preview", nodes: [] };
 },
 async runs(id) {
  const list = await this.list(); if (list.find(graph => graph.id === id)?.kind !== "flow") return clientFor(id).runs(id);
  const [{ runs }, routine] = await Promise.all([routinesApi.runs(id), routinesApi.get(id)]);
  return Promise.all(runs.map(async run => {
   const running = !run.endedAt && !run.abortedAt;
   const nodes: StudioRun["nodes"] = routine.specVersion === 2
    ? running ? [] : (await routinesApi.graphRun(id, run.id)).nodeRuns.map(node => ({ nodeId: node.nodeId, startedAt: node.startedAt ?? run.startedAt, endedAt: node.endedAt, status: node.status === "success" ? "ok" as const : node.status === "skipped" ? "skipped" as const : "failed" as const, note: node.error }))
    : (await routinesApi.steps(id, run.id)).steps.map(step => ({ nodeId: step.stepId, startedAt: step.startedAt, endedAt: step.endedAt, status: step.status === "success" ? "ok" as const : step.status === "failed" || step.status === "aborted" ? "failed" as const : step.status === "running" ? "running" as const : "skipped" as const, note: step.error ?? step.stdoutExcerpt }));
   return { id: run.id, graphId: id, startedAt: run.startedAt, endedAt: run.endedAt, ok: running ? null : !run.error && !run.abortReason && !run.stepCountFailed, trigger: run.trigger, costUsd: run.totalLlmCostMicros / 1_000_000, nodes };
  }));
 },
 source: id => clientFor(id).source(id), saveSource: (id, source) => clientFor(id).saveSource(id, source),
};
export const studio: StudioClient = SOURCES.studio === "live" ? live : preview;
