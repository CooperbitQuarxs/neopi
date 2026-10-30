import { Hono } from "hono";
import { graphFromToml, graphToToml, isGraphValue, NODE_TYPES, nodeType, studioNodeExecution, type StudioGraph, type StudioRunOptions } from "@npi-deck/protocol";
import { deleteStudioGraph, getStudioGraph, listStudioGraphs, listStudioRuns, saveStudioGraph, storeStudioRun } from "./db/studio-graphs.ts";
import { validateStudioGraph } from "./studio-graph-validation.ts";
import { getRoutine, listRoutines } from "./db/routines.ts";
import { runStudioGraph, StudioRunValidationError } from "./studio-graph-runner.ts";

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export function buildGraphsRouter(): Hono {
	const app = new Hono();
	const running = new Set<string>();
	app.get("/graphs", c => c.json({ graphs: [
		...listStudioGraphs(),
		...listRoutines().map(routine => ({
			id: routine.id, kind: "flow" as const, name: routine.name, description: routine.description,
			enabled: routine.enabled, nodes: routine.graph?.nodes.length ?? 1,
			...(routine.lastRunAt ? { lastRun: { at: routine.lastRunAt } } : {}),
		})),
		{ id: "map", kind: "map" as const, name: "Knowledge map", description: "Every note and the links between them", nodes: 0, enabled: true },
	] }));
	app.get("/graphs/node-types", c => {
		const kind = c.req.query("kind");
		if (kind && !["pipeline", "router", "classifier", "boardflow", "flow", "map"].includes(kind)) return c.json({ error: "Unknown graph kind." }, 400);
		return c.json({ nodeTypes: NODE_TYPES.filter(node => !kind || node.kind === kind).map(node => ({ ...node, execution: studioNodeExecution(node.type) })) });
	});
	app.post("/graphs", async c => {
		try {
			const body: unknown = await c.req.json();
			if (!object(body) || typeof body.kind !== "string" || typeof body.name !== "string") return c.json({ error: "kind and name are required." }, 400);
			// A complete document may retain its browser-authored id during cutover.
			const graph = body.nodes === undefined ? { id: crypto.randomUUID(), kind: body.kind, name: body.name, description: "", enabled: false, nodes: [], edges: [], settings: {}, updatedAt: new Date().toISOString() } : body;
			if (typeof graph.id !== "string") return c.json({ error: "A complete imported graph needs an id." }, 400);
			if (graph.id === "map" || getRoutine(graph.id) || getStudioGraph(graph.id)) return c.json({ error: "A graph with this id already exists." }, 409);
			validateStudioGraph(graph, graph.id);
			return c.json(saveStudioGraph(graph), 201);
		} catch (error) { return c.json({ error: message(error) }, 400); }
	});
	app.get("/graphs/:id", c => {
		const graph = getStudioGraph(c.req.param("id"));
		if (!graph) return c.json({ error: "Graph not found." }, 404);
		if (c.req.query("format") === "toml") return c.text(graphToToml(graph), 200, { "content-type": "text/toml; charset=utf-8" });
		return c.json(graph);
	});
	app.put("/graphs/:id", async c => {
		const id = c.req.param("id"), previous = getStudioGraph(id);
		if (!previous) return c.json({ error: "Graph not found." }, 404);
		if (running.has(id)) return c.json({ error: "Wait for the current graph run before editing its definition." }, 409);
		try {
			const type = c.req.header("content-type")?.split(";")[0]?.trim();
			const graph: unknown = type === "text/toml" ? graphFromToml(await c.req.text(), previous, Bun.TOML.parse) : await c.req.json();
			if (!getStudioGraph(id)) return c.json({ error: "Graph not found." }, 404);
			if (running.has(id)) return c.json({ error: "Wait for the current graph run before editing its definition." }, 409);
			validateStudioGraph(graph, id);
			if (graph.kind !== previous.kind) return c.json({ error: "A graph's kind cannot change. Create another graph instead." }, 400);
			return c.json(saveStudioGraph(graph));
		} catch (error) { return c.json({ error: message(error) }, 400); }
	});
	app.delete("/graphs/:id", c => {
		const id = c.req.param("id");
		if (running.has(id)) return c.json({ error: "Wait for the current graph run before deleting it." }, 409);
		return deleteStudioGraph(id) ? c.json({ ok: true }) : c.json({ error: "Graph not found." }, 404);
	});
	app.get("/graphs/:id/runs", c => getStudioGraph(c.req.param("id")) ? c.json({ runs: listStudioRuns(c.req.param("id")) }) : c.json({ error: "Graph not found." }, 404));
	app.post("/graphs/:id/run", async c => {
		const id = c.req.param("id");
		let graph = getStudioGraph(id);
		if (!graph) return c.json({ error: "Graph not found." }, 404);
		if (running.has(id)) return c.json({ error: "This graph already has a running instance." }, 409);
		let body: StudioRunOptions = {};
		try {
			const source = await c.req.text();
			const value: unknown = source.trim() ? JSON.parse(source) : {};
			if (!object(value) || value.mode !== undefined && !["preview", "execute"].includes(String(value.mode)) || value.input !== undefined && !isGraphValue(value.input) || Object.keys(value).some(key => !["mode", "input"].includes(key))) return c.json({ error: "Use { mode: 'preview' | 'execute', input?: JSON }. The default is a write-free preview." }, 400);
			body = value as StudioRunOptions;
			graph = getStudioGraph(id);
			if (!graph) return c.json({ error: "Graph not found." }, 404);
			if (running.has(id)) return c.json({ error: "This graph already has a running instance." }, 409);
			validateStudioGraph(graph, id);
			if (body.mode === "execute") {
				const unsupported = graph.nodes.filter(node => studioNodeExecution(node.type) === "preview");
				if (unsupported.length) return c.json({
					error: "Some nodes do not have an execution adapter. No inference or actions were sent.",
					unsupported: unsupported.map(node => ({ nodeId: node.id, type: node.type })),
					problems: unsupported.map(node => ({ nodeId: node.id, message: `${String(node.config.name || nodeType(node.type)?.label || node.type)} (${node.id}) has no execution adapter.` })),
				}, 409);
			}
		} catch (error) { return c.json({ error: message(error) }, 400); }
		running.add(id);
		try {
			const run = await runStudioGraph(graph, body);
			storeStudioRun(graph, run);
			return c.json(run, 201);
		} catch (error) {
			return error instanceof StudioRunValidationError
				? c.json({ error: error.message, problems: error.problems }, 400)
				: c.json({ error: message(error) }, 400);
		}
		finally { running.delete(id); }
	});
	return app;
}
