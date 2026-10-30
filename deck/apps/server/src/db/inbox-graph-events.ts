import { INBOX_CARD_ADDED_EVENT, type GraphActivation, type GraphObject, type InboxItem, type RoutineGraph, type RoutineRun } from "@npi-deck/protocol";
import { afterCommit, getDb } from "./index.ts";
import { finishGraphRun, listRoutines } from "./routines.ts";

const listeners = new Set<() => void>();
export function subscribeInboxGraphEvents(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** Called inside the card's transaction; disabled/unconfigured flows get no backlog. */
export function enqueueInboxGraphEvents(card: InboxItem): void {
	const db = getDb();
	const event = JSON.stringify(card);
	for (const routine of listRoutines()) {
		if (!routine.enabled || routine.specVersion !== 2 || !routine.graph) continue;
		for (const node of routine.graph.nodes) {
			if (!["event.source", INBOX_CARD_ADDED_EVENT].includes(node.type) || node.config.eventType !== INBOX_CARD_ADDED_EVENT) continue;
			db.query("INSERT INTO inbox_graph_events (card_id, routine_id, source_node_id, event_json) VALUES (?, ?, ?, ?)")
				.run(card.id, routine.id, node.id, event);
		}
	}
	afterCommit(() => { for (const listener of listeners) listener(); });
}

export interface InboxGraphDelivery {
	routineId: string;
	activation: GraphActivation & { event: GraphObject };
}

/** Only committed pending deliveries, not existing inbox cards or admitted work. */
export function pendingInboxGraphEvents(): InboxGraphDelivery[] {
	return getDb().query<{ routine_id: string; source_node_id: string; event_json: string }, []>(
		"SELECT routine_id, source_node_id, event_json FROM inbox_graph_events WHERE state = 'pending' ORDER BY rowid",
	).all().map((row) => ({
		routineId: row.routine_id,
		activation: { eventType: INBOX_CARD_ADDED_EVENT, sourceNodeId: row.source_node_id, event: JSON.parse(row.event_json) },
	}));
}

function inboxEventId(activation: GraphActivation): string | undefined {
	return !Array.isArray(activation.event) && typeof activation.event.id === "string" ? activation.event.id : undefined;
}

/** Notification payloads are only identities; dispatch always uses the committed snapshot. */
export function inboxGraphEventsFor(routineId: string, activation: GraphActivation): InboxGraphDelivery[] {
	const cardId = inboxEventId(activation);
	if (cardId === undefined) return [];
	const rows = getDb().query<{ source_node_id: string; event_json: string }, [string, string]>(
		"SELECT source_node_id, event_json FROM inbox_graph_events WHERE routine_id = ? AND card_id = ? AND state = 'pending' ORDER BY rowid",
	).all(routineId, cardId);
	return rows.filter((row) => activation.sourceNodeId === undefined || activation.sourceNodeId === row.source_node_id)
		.map((row) => ({ routineId, activation: {
			eventType: INBOX_CARD_ADDED_EVENT, sourceNodeId: row.source_node_id, event: JSON.parse(row.event_json),
		} }));
}

export function discardInboxGraphEvent(routineId: string, activation: GraphActivation): void {
	const cardId = inboxEventId(activation);
	if (cardId === undefined) return;
	getDb().query("UPDATE inbox_graph_events SET state = 'discarded' WHERE card_id = ? AND routine_id = ? AND source_node_id = ? AND state = 'pending'")
		.run(cardId, routineId, activation.sourceNodeId!);
}

/** The receipt and startRun commit together, before any asynchronous handler executes. */
export function admitInboxGraphEvent(routineId: string, activation: GraphActivation, graph: RoutineGraph, start: () => RoutineRun): RoutineRun | undefined {
	const cardId = inboxEventId(activation);
	if (cardId === undefined) return undefined;
	const db = getDb();
	return db.transaction(() => {
		const claim = db.query("UPDATE inbox_graph_events SET state = 'admitted' WHERE card_id = ? AND routine_id = ? AND source_node_id = ? AND state = 'pending'")
			.run(cardId, routineId, activation.sourceNodeId!);
		if (!claim.changes) return undefined;
		const run = start();
		db.query("UPDATE inbox_graph_events SET run_id = ?, graph_json = ? WHERE card_id = ? AND routine_id = ? AND source_node_id = ?")
			.run(run.id, JSON.stringify(graph), cardId, routineId, activation.sourceNodeId!);
		return run;
	})();
}

/** Admitted work is never replayed after a crash: external effects may have happened. */
export function recoverInboxGraphEvents(): void {
	const rows = getDb().query<{
		routine_id: string; source_node_id: string; event_json: string; graph_json: string;
		run_id: string; started_at: string;
	}, []>(`SELECT e.routine_id, e.source_node_id, e.event_json, e.graph_json, e.run_id, r.started_at
		FROM inbox_graph_events e JOIN routine_runs r ON r.id = e.run_id
		WHERE e.state = 'admitted' AND r.ended_at IS NULL`).all();
	for (const row of rows) finishGraphRun({
		id: row.run_id, routineId: row.routine_id, startedAt: row.started_at, endedAt: new Date().toISOString(),
		graph: JSON.parse(row.graph_json),
		activation: { eventType: INBOX_CARD_ADDED_EVENT, sourceNodeId: row.source_node_id, event: JSON.parse(row.event_json) },
		status: "aborted", abortReason: "cancelled", error: "server_restarted: intake may have run; not replayed",
		nodeRuns: [], outputs: [],
	}, "server_restarted");
}
