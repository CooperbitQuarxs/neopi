import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import type { CardRun } from "@npi-deck/protocol";
import { CardAgentRunner } from "./card-agents.ts";
import type { Config } from "./config.ts";
import { closeDb, getDb, openDb } from "./db/index.ts";
import { saveCardRun } from "./db/card-runs.ts";
import { createTask, getTask, moveTask, updateTask } from "./db/tasks.ts";
import { taskEvents } from "./db/task-evidence.ts";
import { buildTasksRouter } from "./routes-tasks.ts";

let root: string;
beforeEach(() => {
	const base = process.env.TMPDIR ?? path.join(process.env.HOME!, ".cache/npi-canary/neodeck-pool/BoardWheel");
	mkdirSync(base, { recursive: true });
	root = mkdtempSync(path.join(base, "task-evidence-"));
	openDb({ path: path.join(root, "deck.db") });
});
afterEach(() => { closeDb(); rmSync(root, { recursive: true, force: true }); });

test("card receipts persist notes, lifecycle changes and every assignment across reopen", async () => {
	const task = createTask({ title: "Investigate indexing", properties: { origin: "inbox", origin_ref: "capture-12" } });
	const app = buildTasksRouter();
	const request = (resource: string, init?: RequestInit) => app.request(`/tasks/${task.id}/${resource}`, init);
	expect((await request("events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "Researcher", text: "Index is locked by another writer" }) })).status).toBe(201);
	moveTask(task.id, "s_active", 0);
	updateTask(task.id, { archived: true });
	for (let index = 0; index < 2; index++) {
		const run: CardRun = { id: `run-${index}`, taskId: task.id, status: index ? "completed" : "failed", assignedAt: `2026-10-22T01:0${index}:00Z`, startedAt: `2026-10-22T01:0${index}:01Z`, finishedAt: `2026-10-22T01:0${index}:02Z`, model: "provider/model:high", outcome: index ? "Index rebuilt" : undefined, error: index ? undefined : "Writer unavailable", ownedWorktree: true };
		saveCardRun(run);
	}
	closeDb(); openDb({ path: path.join(root, "deck.db") });
	const response = await request("events");
	expect(response.status).toBe(200);
	const { events } = await response.json() as { events: Array<{ id: string; text: string; actor: string }> };
	expect(events.some(event => event.text === "Index is locked by another writer" && event.actor === "Researcher")).toBe(true);
	expect(events.some(event => event.id === "run-0-finished" && event.text === "Writer unavailable")).toBe(true);
	expect(events.some(event => event.id === "run-1-finished" && event.text === "Index rebuilt")).toBe(true);
	expect(events).toHaveLength(11);
});

test("rolled-back task changes never leave receipts", () => {
	const task = createTask({ title: "Keep the original" });
	const before = taskEvents(task);
	expect(() => getDb().transaction(() => { updateTask(task.id, { title: "Never happened" }); moveTask(task.id, "s_active", 0); throw new Error("rollback"); })()).toThrow("rollback");
	expect(getTask(task.id)?.title).toBe(task.title);
	expect(taskEvents(getTask(task.id)!)).toEqual(before);
});

test("linked evidence uses persisted references and run output, never fixture card numbers", async () => {
	const task = createTask({ title: "Linked work", properties: { links: { issue: { repo: "office/project", number: 15, url: "javascript:alert(1)" }, thread: { id: "native-session" }, flow: { id: "routine-1", name: "Intake" } } } });
	saveCardRun({ id: "published", taskId: task.id, status: "completed", assignedAt: "2026-10-22T01:00:00Z", ownedWorktree: false, outcome: "Published https://github.com/office/project/pull/18" });
	const links = await (await buildTasksRouter().request(`/tasks/${task.id}/links`)).json();
	expect(links).toEqual({ issue: { repo: "office/project", number: 15, url: "https://github.com/office/project/issues/15" }, pr: { repo: "office/project", number: 18, url: "https://github.com/office/project/pull/18" }, thread: { id: "native-session" }, flow: { id: "routine-1", name: "Intake" } });
	expect((await buildTasksRouter().request("/tasks/missing/events")).status).toBe(404);
});

test("per-run model selectors preserve roles and effort without rewriting card properties", async () => {
	const runner = new CardAgentRunner({ defaultCwd: root, cardAgentModel: "default/model" } as Config);
	try {
		const task = createTask({ title: "Queued assignment", properties: { model: "card/model:medium" } });
		const run = runner.assign(task.id, "@research:high");
		expect(run.role).toBe("research:high");
		expect(run.model).toBeUndefined();
		expect(getTask(task.id)?.body).toBe(task.body);
		await runner.cancel(task.id);
		const next = runner.assign(task.id, "provider/selected:xhigh");
		expect(next.model).toBe("provider/selected:xhigh");
		expect(next.role).toBeUndefined();
		await runner.cancel(task.id);
	} finally { await runner.dispose(); }
});
