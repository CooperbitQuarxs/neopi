import { INBOX_CARD_ADDED_EVENT, type GraphRunRecord, type InboxDestination, type InboxHistoryEvent, type InboxItem, type InboxProposal, type InboxReceipt, type InboxRouting, type Task } from "@npi-deck/protocol";
import { getDb, nowIso } from "./index.ts";
import { DEFAULT_INBOX_TICKET_ROUTINE_ID, getRoutine, listRoutines } from "./routines.ts";
import { getDefaultState, listStates } from "./tasks.ts";

export function inboxRouting(): InboxRouting {
	const flow = getRoutine(DEFAULT_INBOX_TICKET_ROUTINE_ID);
	const repository = flow?.graph?.nodes.find(node => node.type === "operation.inbox-route")?.config.repository;
	return {
		defaultFlow: { id: DEFAULT_INBOX_TICKET_ROUTINE_ID, enabled: flow?.enabled ?? true, repository: typeof repository === "string" ? repository : "", protected: true, url: `/studio?graph=${DEFAULT_INBOX_TICKET_ROUTINE_ID}` },
		classifier: {
			kind: "manual", name: "Explicit kind and repository rules",
			description: "Only original tickets follow the configured default GitHub route. Other kinds stay here. Model classification needs a NeoPi contract.",
		},
		flows: listRoutines().flatMap(routine => routine.specVersion === 2 && routine.graph
			? routine.graph.nodes.filter(node => ["event.source", INBOX_CARD_ADDED_EVENT].includes(node.type) && node.config.eventType === INBOX_CARD_ADDED_EVENT)
				.map(node => ({ id: routine.id, name: routine.name, enabled: routine.enabled, sourceNodeId: node.id, url: `/studio?graph=${encodeURIComponent(routine.id)}` }))
			: []),
		columns: listStates().map(state => ({ id: state.id, name: state.name })),
		defaultColumn: getDefaultState().id,
		destinations: [
			{ kind: "card", available: true },
			{ kind: "issue", available: true },
			{ kind: "thread", available: false, reason: "Starting an agent from an inbox item needs NeoPi's template-instantiation contract." },
			{ kind: "note", available: false, reason: "Knowledge writes require a project agent's kb_write tool. File a card for an agent instead." },
		],
	};
}

export function inboxProposal(item: InboxItem): InboxProposal {
	const column = getDefaultState();
	const pending = getDb().query<{ destination_json: string }, [string]>("SELECT destination_json FROM inbox_filing_requests WHERE item_id = ?").get(item.id);
	if (pending && !inboxFiling(item.id)) return {
		itemId: item.id, kind: item.kind, destination: JSON.parse(pending.destination_json) as InboxDestination,
		confidence: 0, classifier: "manual", reason: "A previous filing has no confirmed receipt. Retry this destination to reconcile it before filing elsewhere.",
	};
	return {
		itemId: item.id, kind: item.kind, destination: { kind: "card", project: "", column: column.id },
		confidence: 0, classifier: "manual",
		reason: `No model classified this item. You can file it to ${column.name}, choose another column, or keep it here.`,
	};
}

export function recordInboxFiling(item: InboxItem, task: Task): InboxReceipt {
	const receipt: InboxReceipt = { kind: "card", ref: task.id, url: `/board?card=${encodeURIComponent(task.id)}`, label: `Card T-${task.displayId}` };
	const destination: InboxDestination = { kind: "card", project: task.cwd ?? "", column: task.stateId };
	return recordInboxReceipt(item.id, destination, receipt, task.createdAt);
}

export function recordInboxReceipt(itemId: string, destination: InboxDestination, receipt: InboxReceipt, at = nowIso()): InboxReceipt {
	getDb().query(`INSERT OR IGNORE INTO inbox_filing_receipts (item_id, ref, destination_json, receipt_json, filed_at) VALUES (?, ?, ?, ?, ?)`)
		.run(itemId, receipt.ref, JSON.stringify(destination), JSON.stringify(receipt), at);
	return receipt;
}

export function inboxFiling(itemId: string): { destination: InboxDestination; receipt: InboxReceipt } | undefined {
	const row = getDb().query<{ destination_json: string; receipt_json: string }, [string]>(
		"SELECT destination_json, receipt_json FROM inbox_filing_receipts WHERE item_id = ? ORDER BY filed_at DESC LIMIT 1",
	).get(itemId);
	if (row) return { destination: JSON.parse(row.destination_json) as InboxDestination, receipt: JSON.parse(row.receipt_json) as InboxReceipt };
	const legacy = getDb().query<{ response_json: string }, [string]>(
		"SELECT response_json FROM inbox_mutation_receipts WHERE scope = ? LIMIT 1",
	).get(`promote:${itemId}`);
	const task = legacy ? (JSON.parse(legacy.response_json) as { task?: Task }).task : undefined;
	return task ? {
		destination: { kind: "card", project: task.cwd ?? "", column: task.stateId },
		receipt: { kind: "card", ref: task.id, url: `/board?card=${encodeURIComponent(task.id)}`, label: `Card T-${task.displayId}` },
	} : undefined;
}

export class InboxFilingConflictError extends Error {}

/** Keep the original capture and destination stable across ambiguous external writes. */
export function reserveInboxFiling(item: InboxItem, destination: InboxDestination): InboxItem {
	return getDb().transaction(() => {
		const encoded = JSON.stringify(destination);
		const prior = inboxFiling(item.id);
		if (prior && JSON.stringify(prior.destination) !== encoded) throw new InboxFilingConflictError("This item was already filed elsewhere. Open its history to find the receipt.");
		const existing = getDb().query<{ destination_json: string; item_json: string }, [string]>(
			"SELECT destination_json, item_json FROM inbox_filing_requests WHERE item_id = ?",
		).get(item.id);
		if (existing) {
			if (existing.destination_json !== encoded) throw new InboxFilingConflictError("Another filing is unresolved. Retry that destination to reconcile it before filing elsewhere.");
			return JSON.parse(existing.item_json) as InboxItem;
		}
		getDb().query("INSERT INTO inbox_filing_requests (item_id, destination_json, item_json, created_at) VALUES (?, ?, ?, ?)")
			.run(item.id, encoded, JSON.stringify(item), nowIso());
		return item;
	})();
}

export function releaseInboxFiling(itemId: string, destination: InboxDestination): void {
	getDb().query("DELETE FROM inbox_filing_requests WHERE item_id = ? AND destination_json = ?").run(itemId, JSON.stringify(destination));
}

export function inboxHistory(item: InboxItem): InboxHistoryEvent[] {
	const events: InboxHistoryEvent[] = [{ at: item.createdAt, actor: item.source || "Inbox", text: `Captured as ${item.kind}.` }];
	const refs = new Set<string>();
	const filings = getDb().query<{ receipt_json: string; filed_at: string }, [string]>(
		"SELECT receipt_json, filed_at FROM inbox_filing_receipts WHERE item_id = ? ORDER BY filed_at",
	).all(item.id);
	for (const row of filings) {
		const receipt = JSON.parse(row.receipt_json) as InboxReceipt;
		refs.add(receipt.ref);
		events.push({ at: row.filed_at, actor: "Inbox", text: `Filed to ${receipt.label}.`, url: receipt.url, receipt });
	}
	// Older keyed promotions already have durable receipts, but no history table.
	const legacy = getDb().query<{ response_json: string }, [string]>(
		"SELECT response_json FROM inbox_mutation_receipts WHERE scope = ?",
	).all(`promote:${item.id}`);
	for (const row of legacy) {
		const value = JSON.parse(row.response_json) as { task?: Task };
		if (!value.task || refs.has(value.task.id)) continue;
		const task = value.task;
		refs.add(task.id);
		const receipt: InboxReceipt = { kind: "card", ref: task.id, url: `/board?card=${encodeURIComponent(task.id)}`, label: `Card T-${task.displayId}` };
		events.push({ at: task.createdAt, actor: "Inbox", text: `Filed to ${receipt.label}.`, url: receipt.url, receipt });
	}
	if (filings.length === 0 && legacy.length === 0) {
		const pending = getDb().query<{ destination_json: string; created_at: string }, [string]>(
			"SELECT destination_json, created_at FROM inbox_filing_requests WHERE item_id = ?",
		).get(item.id);
		if (pending) {
			const destination = JSON.parse(pending.destination_json) as InboxDestination;
			events.push({ at: pending.created_at, actor: "Inbox", text: `Filing requested${destination.kind === "issue" ? ` to ${destination.repo}` : ""}. No confirmed receipt yet. Retry the same destination to reconcile it.` });
		}
	}
	const deliveries = getDb().query<{
		routine_id: string; name: string; source_node_id: string; state: string; run_id: string | null;
		started_at: string | null; ended_at: string | null; error: string | null; graph_run_json: string | null;
	}, [string]>(`SELECT e.routine_id, r.name, e.source_node_id, e.state, e.run_id,
		x.started_at, x.ended_at, x.error, x.graph_run_json
		FROM inbox_graph_events e JOIN routines r ON r.id = e.routine_id
		LEFT JOIN routine_runs x ON x.id = e.run_id WHERE e.card_id = ?`).all(item.id);
	for (const delivery of deliveries) {
		const trace = delivery.graph_run_json ? JSON.parse(delivery.graph_run_json) as GraphRunRecord : undefined;
		const state = delivery.state === "pending" ? "queued" : delivery.state === "discarded" ? "discarded before starting"
			: !delivery.ended_at ? "running" : trace?.status ?? (delivery.error ? "failed" : "finished");
		events.push({ at: delivery.ended_at ?? delivery.started_at ?? item.createdAt, actor: delivery.name,
			text: `Flow ${state}. Source ${delivery.source_node_id}${delivery.run_id ? `, run ${delivery.run_id}` : ""}.`,
			url: `/studio?graph=${encodeURIComponent(delivery.routine_id)}` });
		for (const node of trace?.nodeRuns ?? []) {
			for (const effect of node.effects ?? []) {
				const accepted = effect.receipt;
				let receipt: InboxReceipt | undefined;
				if (effect.status === "confirmed" && accepted) {
					if (node.type === "action.create-card" && typeof accepted.id === "string") {
						receipt = { kind: "card", ref: accepted.id, url: `/board?card=${encodeURIComponent(accepted.id)}`, label: `Card T-${accepted.displayId}` };
					} else if (node.type === "action.file-issue" && accepted.issue && typeof accepted.issue === "object" && !Array.isArray(accepted.issue)
						&& typeof accepted.issue.url === "string" && typeof accepted.issue.number === "number") {
						receipt = { kind: "issue", ref: `${accepted.repository}#${accepted.issue.number}`, url: accepted.issue.url, label: `${accepted.repository}#${accepted.issue.number}` };
					}
				}
				if (receipt && refs.has(receipt.ref)) continue;
				if (receipt) refs.add(receipt.ref);
				events.push({ at: node.endedAt, actor: delivery.name,
					text: receipt ? `Filed to ${receipt.label}.` : `${node.type === "action.send-message" ? "Message delivery" : "Action"} ${effect.status}.`,
					...(receipt ? { receipt, url: receipt.url } : {}) });
			}
		}
	}
	if (item.processedAt) events.push({ at: item.processedAt, actor: "Inbox", text: "Marked done." });
	return events.sort((a, b) => a.at.localeCompare(b.at));
}
