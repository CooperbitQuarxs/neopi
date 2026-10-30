import { Hono } from "hono";
import type {
	CreateInboxItemRequest,
	InboxKind,
	ListInboxResponse,
	PromoteInboxItemRequest,
	PromoteInboxItemResponse,
	UpdateInboxItemRequest,
} from "@npi-deck/protocol";

import { createInbox, deleteInbox, getInbox, inboxMutation, listInbox, updateInbox } from "./db/inbox.ts";
import { createTask, getDefaultState, getState, listStates } from "./db/tasks.ts";
import { getDb } from "./db/index.ts";
import { InboxFilingConflictError, inboxFiling, inboxHistory, inboxProposal, inboxRouting, recordInboxFiling, reserveInboxFiling } from "./db/inbox-routing.ts";
import { fileInboxIssue } from "./inbox-issue.ts";
import { installDefaultInboxFlow, parseInboxRepository, registerInboxFlowNodes } from "./inbox-flow.ts";
import { DEFAULT_INBOX_TICKET_ROUTINE_ID, getRoutine, updateGraphRoutine } from "./db/routines.ts";
import { executeGraph, GraphNodeRegistry } from "./routines/graph-runner.ts";
import { registerGraphActions } from "./routines/graph-actions.ts";

const KINDS: ReadonlySet<InboxKind> = new Set([
	"email",
	"ticket",
	"idea",
	"decision",
	"investigation",
	"capture",
]);

export function buildInboxRouter(): Hono {
	const app = new Hono();
	const registry = new GraphNodeRegistry();
	registerGraphActions(registry);
	registerInboxFlowNodes(registry);
	installDefaultInboxFlow(registry);

	app.get("/inbox", (c) => {
		const kindParam = c.req.query("kind");
		const includeProcessed = c.req.query("includeProcessed") === "1";
		const kind = kindParam && KINDS.has(kindParam as InboxKind) ? (kindParam as InboxKind) : undefined;
		const opts: { kind?: InboxKind; includeProcessed?: boolean } = { includeProcessed };
		if (kind) opts.kind = kind;
		const body: ListInboxResponse = { items: listInbox(opts) };
		return c.json(body);
	});

	app.post("/inbox", async (c) => {
		let body: CreateInboxItemRequest;
		try {
			body = (await c.req.json()) as CreateInboxItemRequest;
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}
		if (!body.title || !body.kind) return c.json({ error: "title and kind required" }, 400);
		try {
			const item = inboxMutation("create", c.req.header("Idempotency-Key"), () => createInbox(body));
			return c.json(item, 201);
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	app.get("/inbox/routing", (c) => c.json(inboxRouting()));

	app.patch("/inbox/routing", async (c) => {
		try {
			const body = await c.req.json();
			if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["enabled", "repository"].includes(key))
				|| (body.enabled !== undefined && typeof body.enabled !== "boolean") || (body.repository !== undefined && typeof body.repository !== "string")) return c.json({ error: "Use enabled boolean and repository string." }, 400);
			const flow = getRoutine(DEFAULT_INBOX_TICKET_ROUTINE_ID)!;
			const graph = structuredClone(flow.graph!);
			if (body.repository !== undefined) {
				const route = graph.nodes.find(node => node.type === "operation.inbox-route");
				if (!route) return c.json({ error: "This flow was edited. Configure its route in Studio." }, 409);
				route.config.repository = body.repository.trim() ? Object.values(parseInboxRepository(body.repository)).join("/") : "";
			}
			updateGraphRoutine(flow.id, { graph, enabled: body.enabled }, registry);
			return c.json(inboxRouting());
		} catch (error) { return c.json({ error: String(error) }, 400); }
	});

	app.post("/inbox/routing/preview", async (c) => {
		try {
			const body = await c.req.json();
			if (!body || !KINDS.has(body.kind) || typeof body.title !== "string" || !body.title.trim() || (body.body !== undefined && typeof body.body !== "string")) return c.json({ error: "A valid kind, title and body are required." }, 400);
			const flow = getRoutine(DEFAULT_INBOX_TICKET_ROUTINE_ID)!;
			const source = flow.graph!.nodes.find(node => node.config.eventType === "inbox.card_added" && registry.get(node.type)?.definition.kind === "event");
			if (!source) return c.json({ error: "The default graph has no inbox event source. Restore one in Studio." }, 409);
			const activation = { eventType: "inbox.card_added", sourceNodeId: source.id, event: { id: "preview", kind: body.kind, title: body.title, body: body.body ?? "", createdAt: new Date().toISOString() } };
			const startedAt = new Date().toISOString();
			const result = flow.enabled
				? await executeGraph(flow.graph!, activation, registry, { routineId: flow.id, runId: "preview", dryRun: true, signal: c.req.raw.signal })
				: { status: "aborted" as const, error: "Default route is paused; no new item would be dispatched.", nodeRuns: [], outputs: [] };
			return c.json({ ...result, id: "preview", routineId: flow.id, startedAt, endedAt: new Date().toISOString(), graph: flow.graph, activation, dryRun: true });
		} catch (error) { return c.json({ error: String(error) }, 400); }
	});

	app.get("/inbox/:id/proposal", (c) => {
		const item = getInbox(c.req.param("id"));
		return item ? c.json(inboxProposal(item)) : c.json({ error: "not found" }, 404);
	});

	app.get("/inbox/:id/history", (c) => {
		const item = getInbox(c.req.param("id"));
		return item ? c.json({ events: inboxHistory(item) }) : c.json({ error: "not found" }, 404);
	});

	app.post("/inbox/:id/file", async (c) => {
		const item = getInbox(c.req.param("id"));
		if (!item) return c.json({ error: "not found" }, 404);
		let body: unknown;
		try { body = await c.req.json(); }
		catch { return c.json({ error: "invalid json" }, 400); }
		if (!body || typeof body !== "object" || !("destination" in body)) return c.json({ error: "destination required" }, 400);
		const destination = body.destination;
		if (!destination || typeof destination !== "object" || !("kind" in destination) || typeof destination.kind !== "string") {
			return c.json({ error: "invalid destination" }, 400);
		}
		const capability = inboxRouting().destinations.find(entry => entry.kind === destination.kind);
		if (!capability) return c.json({ error: "unknown destination kind" }, 400);
		if (!capability.available) return c.json({ error: capability.reason }, 501);
		if ("dryRun" in body && typeof body.dryRun !== "boolean") return c.json({ error: "dryRun must be a boolean" }, 400);
		if (destination.kind === "issue") {
			if (!("repo" in destination) || typeof destination.repo !== "string") return c.json({ error: "issue destination requires repo" }, 400);
			try {
				const result = await fileInboxIssue(item, destination.repo, "dryRun" in body && body.dryRun === true,
					AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(30_000)]));
				return c.json(result);
			} catch (error) {
				return c.json({ error: String(error) }, error instanceof InboxFilingConflictError ? 409 : 400);
			}
		}
		if ("dryRun" in body && body.dryRun === true) return c.json({ error: "dryRun is supported for GitHub issue filing only" }, 400);
		if (!("project" in destination) || typeof destination.project !== "string"
			|| !("column" in destination) || typeof destination.column !== "string") {
			return c.json({ error: "card destination requires project and column strings" }, 400);
		}
		const project = destination.project.trim();
		const column = destination.column;
		const state = listStates().find(entry => entry.id === column || entry.name.toLowerCase() === column.toLowerCase());
		if (!state) return c.json({ error: `unknown column: ${column}` }, 400);
		try {
			const result = getDb().transaction(() => {
				const prior = inboxFiling(item.id);
				if (prior) {
					if (prior.destination.kind !== "card" || prior.destination.project !== project || prior.destination.column !== state.id) return null;
					return { receipt: prior.receipt };
				}
				reserveInboxFiling(item, { kind: "card", project, column: state.id });
				const provenance = `_Filed from inbox ${item.id}_`;
				const task = createTask({
					title: item.title, body: item.body.trim() ? `${item.body}\n\n---\n${provenance}` : provenance,
					stateId: state.id, cwd: project || null, properties: { origin: "inbox", origin_ref: item.id },
				});
				const receipt = recordInboxFiling(item, task);
				updateInbox(item.id, { processed: true });
				return { receipt };
			})();
			return result ? c.json(result) : c.json({ error: "This item was already filed elsewhere. Open its history to find the receipt." }, 409);
		} catch (err) { return c.json({ error: String(err) }, err instanceof InboxFilingConflictError ? 409 : 400); }
	});

	app.get("/inbox/:id", (c) => {
		const i = getInbox(c.req.param("id"));
		if (!i) return c.json({ error: "not found" }, 404);
		return c.json(i);
	});

	app.patch("/inbox/:id", async (c) => {
		let body: UpdateInboxItemRequest;
		try {
			body = (await c.req.json()) as UpdateInboxItemRequest;
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}
		try {
			const updated = updateInbox(c.req.param("id"), body);
			if (!updated) return c.json({ error: "not found" }, 404);
			return c.json(updated);
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	app.delete("/inbox/:id", (c) => {
		const ok = deleteInbox(c.req.param("id"));
		return c.json({ ok });
	});

	app.post("/inbox/:id/promote", async (c) => {
		const itemId = c.req.param("id");
		const item = getInbox(itemId);
		if (!item) return c.json({ error: "not found" }, 404);

		let body: PromoteInboxItemRequest = {};
		// Body is optional — accept missing/empty JSON without bouncing the request.
		try {
			const raw = await c.req.text();
			if (raw.trim().length > 0) body = JSON.parse(raw) as PromoteInboxItemRequest;
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}

		// Validate stateId up front so a typo doesn't half-promote (task created,
		// inbox marked processed) before the createTask path fails.
		if (body.stateId && !getState(body.stateId)) {
			return c.json({ error: `unknown stateId: ${body.stateId}` }, 400);
		}
		if (body.cwd !== undefined && typeof body.cwd !== "string") {
			return c.json({ error: "cwd must be a string" }, 400);
		}
		const stateId = body.stateId ?? getDefaultState().id;

		// Provenance footer keeps the link back to the inbox item so the user can
		// trace where the task originated even after the inbox is cleared out.
		const stamp = new Date(item.createdAt).toISOString().slice(0, 10);
		const provenance = `_Promoted from inbox · ${item.kind} · ${stamp} · ${item.id}_`;
		const content = body.body ?? item.body;
		const taskBody = content.trim().length > 0
			? `${content}\n\n---\n${provenance}`
			: provenance;

		try {
			const out = inboxMutation(`promote:${item.id}`, c.req.header("Idempotency-Key"), () => getDb().transaction((): PromoteInboxItemResponse => {
				const task = createTask({ title: item.title, body: taskBody, stateId, properties: body.properties, ...(body.cwd !== undefined ? { cwd: body.cwd } : {}) });
				recordInboxFiling(item, task);
				// Keep recurring-template promotion unchanged when no receipt key is supplied.
				const inbox = body.markProcessed !== false
					? updateInbox(item.id, { processed: true }) ?? item
					: item;
				return { task, inbox };
			})());
			return c.json(out, 201);
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	return app;
}
