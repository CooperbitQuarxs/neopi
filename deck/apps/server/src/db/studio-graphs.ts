import { graphFromToml, graphToToml, type GraphSummary, type StudioGraph, type StudioRun } from "@npi-deck/protocol";
import { getDb } from "./index.ts";

interface GraphRow { id: string; source_toml: string; updated_at: string; last_run_at: string | null; last_run_ok: number | null }
function decode(row: GraphRow): StudioGraph {
	const graph = graphFromToml(row.source_toml, { id: row.id } as StudioGraph, Bun.TOML.parse);
	return { ...graph, updatedAt: row.updated_at, ...(row.last_run_at ? { lastRun: { at: row.last_run_at, ok: row.last_run_ok === 1 } } : {}) };
}
export function getStudioGraph(id: string): StudioGraph | undefined {
	const row = getDb().query<GraphRow, [string]>("SELECT * FROM studio_graphs WHERE id = ?").get(id);
	return row ? decode(row) : undefined;
}
export function listStudioGraphs(): GraphSummary[] {
	return getDb().query<GraphRow, []>("SELECT * FROM studio_graphs ORDER BY updated_at DESC, id").all().map(row => {
		const graph = decode(row);
		return { id: graph.id, kind: graph.kind, name: graph.name, description: graph.description, enabled: graph.enabled, nodes: graph.nodes.length, ...(graph.lastRun ? { lastRun: graph.lastRun } : {}) };
	});
}
export function saveStudioGraph(graph: StudioGraph): StudioGraph {
	const updatedAt = new Date().toISOString();
	getDb().query("INSERT INTO studio_graphs (id, source_toml, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_toml = excluded.source_toml, updated_at = excluded.updated_at").run(graph.id, graphToToml(graph), updatedAt);
	return getStudioGraph(graph.id)!;
}
export function deleteStudioGraph(id: string): boolean { return getDb().query("DELETE FROM studio_graphs WHERE id = ?").run(id).changes > 0; }
export function storeStudioRun(graph: StudioGraph, run: StudioRun): void {
	getDb().transaction(() => {
		getDb().query("INSERT INTO studio_graph_runs (id, graph_id, started_at, graph_toml, record_json) VALUES (?, ?, ?, ?, ?)").run(run.id, graph.id, run.startedAt, graphToToml(graph), JSON.stringify(run));
		if (run.ok !== null) getDb().query("UPDATE studio_graphs SET last_run_at = ?, last_run_ok = ? WHERE id = ?").run(run.startedAt, run.ok ? 1 : 0, graph.id);
	})();
}
export function listStudioRuns(id: string): StudioRun[] {
	return getDb().query<{ record_json: string }, [string]>("SELECT record_json FROM studio_graph_runs WHERE graph_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 100").all(id).map(row => JSON.parse(row.record_json) as StudioRun);
}
