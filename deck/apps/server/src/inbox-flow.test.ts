import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { Hono } from "hono";
import type { GraphObject, GraphRunRecord, InboxItem, InboxKind, InboxRouting } from "@npi-deck/protocol";
import { closeDb, getDb, openDb } from "./db/index.ts";
import { createInbox, getInbox, listInbox, updateInbox } from "./db/inbox.ts";
import { DEFAULT_INBOX_TICKET_ROUTINE_ID as ID, deleteRoutine, getGraphRun, getRoutine, listRoutines, listRuns, updateGraphRoutine } from "./db/routines.ts";
import { installDefaultInboxFlow } from "./inbox-flow.ts";
import { executeGraph, findGraphOutput } from "./routines/graph-runner.ts";
import { githubIssueTransport } from "./routines/github-issues.ts";
import { RoutinesRunner } from "./routines-runner.ts";
import { buildInboxRouter } from "./routes-inbox.ts";
import { buildRoutinesRouter } from "./routes-routines.ts";

let directory = "";
let runner: RoutinesRunner;
afterEach(async () => { await runner?.dispose(); mock.restore(); closeDb(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
function boot() {
	const root = path.join(homedir(), ".cache/npi-canary/neodeck-pool/InboxGithubRouting/tests");
	fs.mkdirSync(root, { recursive: true }); directory = fs.mkdtempSync(path.join(root, "flow-"));
	openDb({ path: path.join(directory, "deck.db") }); runner = new RoutinesRunner();
	return new Hono().route("/api", buildInboxRouter()).route("/api", buildRoutinesRouter(runner));
}
function json(body: unknown, method = "POST"): RequestInit { return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
async function configure(app: Hono, repository = "outside-owner/disposable", enabled = true) {
	const response = await app.request("/api/inbox/routing", json({ repository, enabled }, "PATCH")); expect(response.status).toBe(200);
}
function recordingTransport(options: { lost?: boolean; reject?: boolean } = {}) {
	let posts = 0; let latest: GraphObject | undefined;
	const payloads: GraphObject[] = [];
	const remote = spyOn(githubIssueTransport, "execute").mockImplementation(async command => {
		const response = (value: unknown, status = 200) => ({ exitCode: 0, stderr: "", stdout: `HTTP/2.0 ${status} OK\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(value)}` });
		if (command.args.includes("POST")) {
			posts++; const payload = JSON.parse(command.input!) as GraphObject; payloads.push(payload);
			if (options.reject) return response({ message: "Forbidden" }, 403);
			latest = { id: 9010 + posts, number: posts, html_url: `https://github.com/outside-owner/disposable/issues/${posts}`, repository_url: "https://api.github.com/repos/outside-owner/disposable", body: payload.body! };
			if (options.lost) throw new Error("simulated lost response");
			return response(latest, 201);
		}
		return command.args.some(arg => arg.startsWith("search/issues")) ? response({ total_count: latest ? 1 : 0, incomplete_results: false, items: latest ? [latest] : [] }) : response(latest);
	});
	return { remote, payloads, posts: () => posts };
}
async function deliver(item: InboxItem) { await runner.fireGraphEvent(ID, { eventType: "inbox.card_added", sourceNodeId: "inbox", event: { ...item } }); }
function trace(): GraphRunRecord { return getGraphRun(listRuns(ID)[0]!.id)!; }

test("default is native, enabled, protected, editable and installed once across restart", async () => {
	const app = boot(); const routing = await (await app.request("/api/inbox/routing")).json() as InboxRouting;
	expect(routing.defaultFlow).toMatchObject({ id: ID, enabled: true, repository: "", protected: true });
	expect(runner.graphRegistry.validate(getRoutine(ID)!.graph)).toEqual({ valid: true });
	expect((await app.request(`/api/routines/${ID}`, { method: "DELETE" })).status).toBe(409); expect(deleteRoutine(ID)).toBe(false);
	await configure(app, "enterprise.example/outside-owner/disposable", false);
	closeDb(); openDb({ path: path.join(directory, "deck.db") }); installDefaultInboxFlow(runner.graphRegistry);
	expect(listRoutines().filter(flow => flow.id === ID)).toHaveLength(1); expect(getRoutine(ID)?.enabled).toBe(false);
	expect(getRoutine(ID)!.graph!.nodes.find(node => node.id === "route")!.config.repository).toBe("enterprise.example/outside-owner/disposable");
});

test("committed intake uses the real native runner and only original tickets write and acknowledge", async () => {
	const app = boot(); await configure(app); const recorded = recordingTransport();
	for (const kind of ["ticket", "idea", "capture", "decision", "email", "investigation"] as InboxKind[]) {
		const item = createInbox({ kind, title: `Original ${kind}`, body: "Exact body\n\n**kept**", source: "test" }); await deliver(item);
		const record = trace(); expect(record.status).toBe("success"); expect(record.activation.event).toMatchObject({ id: item.id, kind });
		expect(getInbox(item.id)?.processedAt !== undefined).toBe(kind === "ticket");
		if (kind === "ticket") {
			expect(getInbox(item.id)?.filing).toMatchObject({ kind: "issue", repository: "outside-owner/disposable", issueNumber: 1, logicalKey: expect.any(String) });
			const output = record.nodeRuns.find(node => node.nodeId === "acknowledge")!.outputs[0]!;
			expect(findGraphOutput(output, "inbox")?.result).toEqual({ ...item });
		}
	}
	expect(recorded.posts()).toBe(1); expect(recorded.payloads[0]!.title).toBe("Original ticket"); expect(recorded.payloads[0]!.body).toContain("Exact body\n\n**kept**"); expect(recorded.payloads[0]!.body).toContain("> NeoDeck on behalf of PsychedelicShayna");
});

test("preview uses the installed graph without cards, receipts, provider access or consumed keys", async () => {
	const app = boot(); await configure(app); const recorded = recordingTransport();
	for (const kind of ["ticket", "idea", "capture", "decision", "email", "investigation"]) {
		const response = await app.request("/api/inbox/routing/preview", json({ kind, title: "Planned title", body: "Planned body" })); expect(response.status).toBe(200);
		const record = await response.json() as GraphRunRecord; expect(record.dryRun).toBe(true); expect(record.status).toBe("success");
		const effects = record.nodeRuns.flatMap(node => node.effects ?? []); expect(effects).toHaveLength(kind === "ticket" ? 1 : 0);
		if (kind === "ticket") expect(effects[0]).toMatchObject({ status: "planned", request: { title: "Planned title", body: "Planned body", owner: "outside-owner", repo: "disposable" } });
	}
	expect(recorded.remote).not.toHaveBeenCalled(); expect(listInbox({ includeProcessed: true })).toHaveLength(0);
	for (const table of ["graph_actions", "inbox_filing_requests", "inbox_filing_receipts", "routine_runs"]) expect(getDb().query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(0);
	const item = createInbox({ kind: "ticket", title: "Live after preview" }); await deliver(item); expect(recorded.posts()).toBe(1);
});

test("disabled and unconfigured flows do not file; invalid target is rejected without writes", async () => {
	const app = boot(); const recorded = recordingTransport(); const unconfigured = createInbox({ kind: "ticket", title: "Unconfigured" }); await deliver(unconfigured);
	expect(getInbox(unconfigured.id)?.processedAt).toBeUndefined();
	for (const repository of ["bad/target/extra/slash", "https://github.com/o/r", "bad owner/repo"]) expect((await app.request("/api/inbox/routing", json({ repository }, "PATCH"))).status).toBe(400);
	await configure(app, "outside-owner/disposable", false); const paused = createInbox({ kind: "ticket", title: "Paused" }); await deliver(paused);
	expect(getInbox(paused.id)?.processedAt).toBeUndefined(); expect(recorded.remote).not.toHaveBeenCalled();
	await configure(app); await deliver(paused); expect(recorded.remote).not.toHaveBeenCalled();
	const next = createInbox({ kind: "ticket", title: "Enabled again" }); await deliver(next); expect(recorded.posts()).toBe(1);
});

test("item-wide issue identity survives concurrency, node edits, restart and acknowledgement repair", async () => {
	const app = boot(); await configure(app); const recorded = recordingTransport();
	const item = createInbox({ kind: "ticket", title: "Same content", body: "Original" }); await Promise.all([deliver(item), deliver(item)]);
	expect(recorded.posts()).toBe(1);
	updateInbox(item.id, { processed: false }); getDb().query("DELETE FROM inbox_filing_receipts WHERE item_id = ?").run(item.id);
	closeDb(); openDb({ path: path.join(directory, "deck.db") });
	const graph = structuredClone(getRoutine(ID)!.graph!); const action = graph.nodes.find(node => node.id === "file")!; action.id = "renamed-file";
	for (const edge of graph.edges) { if (edge.from.nodeId === "file") edge.from.nodeId = action.id; if (edge.to.nodeId === "file") edge.to.nodeId = action.id; }
	updateGraphRoutine(ID, { graph }, runner.graphRegistry);
	const replay = await executeGraph(graph, { eventType: "inbox.card_added", sourceNodeId: "inbox", event: { ...item } }, runner.graphRegistry, { routineId: ID });
	expect(replay.status).toBe("success"); expect(recorded.posts()).toBe(1); expect(getInbox(item.id)?.filing?.issueNumber).toBe(1); expect(getInbox(item.id)?.processedAt).toBeDefined();
	await configure(app, "different-owner/different-repo");
	const conflict = await executeGraph(getRoutine(ID)!.graph!, { eventType: "inbox.card_added", sourceNodeId: "inbox", event: { ...item } }, runner.graphRegistry, { routineId: ID });
	expect(conflict.status).toBe("failed"); expect(recorded.posts()).toBe(1);
	await configure(app); const distinct = createInbox({ kind: "ticket", title: item.title, body: item.body }); await deliver(distinct); expect(recorded.posts()).toBe(2);
});

test("rejected and uncertain provider responses never acknowledge; uncertain writes reconcile without POST", async () => {
	const app = boot(); await configure(app); const options = { reject: true, lost: false }; const recorded = recordingTransport(options);
	const rejected = createInbox({ kind: "ticket", title: "Rejected" }); await deliver(rejected); expect(getInbox(rejected.id)?.processedAt).toBeUndefined(); expect(trace().status).toBe("failed");
	options.reject = false; options.lost = true; const uncertain = createInbox({ kind: "ticket", title: "Uncertain" }); await deliver(uncertain); expect(getInbox(uncertain.id)?.filing).toBeUndefined();
	const graph = getRoutine(ID)!.graph!; const replay = await executeGraph(graph, { eventType: "inbox.card_added", sourceNodeId: "inbox", event: { ...uncertain } }, runner.graphRegistry, { routineId: ID });
	expect(replay.status).toBe("success"); expect(recorded.posts()).toBe(2); expect(getInbox(uncertain.id)?.processedAt).toBeDefined();
});

test("automatic listener settles captures and retains confirmed issue evidence when acknowledgement fails", async () => {
	const app = boot(); await configure(app); const recorded = recordingTransport();
	getDb().exec("CREATE TRIGGER reject_inbox_ack BEFORE UPDATE ON inbox_items BEGIN SELECT RAISE(ABORT, 'simulated acknowledgement failure'); END");
	runner.start();
	const response = await app.request("/api/inbox", json({ kind: "ticket", title: "Automatic listener", body: "No manual dispatch" }));
	expect(response.status).toBe(201); const item = await response.json() as InboxItem;
	for (let attempt = 0; attempt < 100 && (!listRuns(ID).length || !getGraphRun(listRuns(ID)[0]!.id)); attempt++) await Bun.sleep(10);
	const record = trace(); expect(record.status).toBe("failed");
	expect(record.nodeRuns.find(node => node.nodeId === "file")!.effects![0]!.status).toBe("confirmed");
	expect(record.nodeRuns.find(node => node.nodeId === "acknowledge")!.status).toBe("failed");
	expect(getInbox(item.id)?.processedAt).toBeUndefined(); expect(getInbox(item.id)?.filing).toBeUndefined();
	getDb().exec("DROP TRIGGER reject_inbox_ack");
	const repaired = await app.request(`/api/inbox/${item.id}/file`, json({ destination: { kind: "issue", repo: "outside-owner/disposable" } }));
	expect(repaired.status).toBe(200); expect(getInbox(item.id)?.filing?.issueNumber).toBe(1); expect(recorded.posts()).toBe(1);
});
