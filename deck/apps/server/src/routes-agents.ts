import { Hono } from "hono";
import type { AgentCapabilities, AgentInstance, AgentTemplateInput, ImageAttachment } from "@npi-deck/protocol";
import type { AgentBridge, SessionHandle } from "./bridge/types.ts";
import { getAgentTemplate, listAgentTemplates, removeAgentTemplate, saveAgentTemplate } from "./db/agent-templates.ts";

const spawnReason = "This NeoPi SDK cannot instantiate an agent template. Agent spawning waits for the neopi#11 hierarchy design.";
const judgeReason = "This NeoPi SDK does not expose a fleet judge, its configuration, events or undo-stop operation.";
function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function definition(value: unknown, id?: string): AgentTemplateInput | undefined {
	if (!object(value)) return;
	const key = id ?? value.id;
	if (typeof key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(key) ||
		typeof value.name !== "string" || !value.name.trim()) return;
	const textKeys = ["description", "model", "thinking", "systemPrompt", "preset"] as const;
	if (textKeys.some(key => value[key] !== undefined && typeof value[key] !== "string") ||
		(value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.some(tool => typeof tool !== "string")))) return;
	const result: AgentTemplateInput = { id: key, name: value.name.trim() };
	for (const key of textKeys) if (value[key] !== undefined) result[key] = value[key] as string;
	if (value.tools !== undefined) result.tools = value.tools as string[];
	return result;
}

export function buildAgentsRouter(bridge: AgentBridge): Hono {
	const app = new Hono();
	const instances = () => bridge.agentInstances?.() ?? [];
	const capabilities = (): AgentCapabilities => ({ templates: true, nativeDefinitions: false,
		instances: typeof bridge.agentInstances === "function", spawn: false, restrictions: false, judge: false,
		reason: "Deck-authored templates are persisted locally. Native definition discovery needs list_agent_definitions. " + spawnReason });
	app.get("/agents/capabilities", c => c.json(capabilities()));
	app.get("/agents/templates", c => c.json({ templates: listAgentTemplates(), capabilities: capabilities() }));
	app.get("/agents/templates/:id", c => {
		const saved = getAgentTemplate(c.req.param("id"));
		return saved ? c.json(saved) : c.json({ error: "template not found" }, 404);
	});
	app.post("/agents/templates", async c => {
		const input = definition(await c.req.json().catch(() => null));
		if (!input) return c.json({ error: "template requires id, name and valid optional configuration" }, 400);
		if (getAgentTemplate(input.id)) return c.json({ error: "template already exists" }, 409);
		return c.json(saveAgentTemplate(input), 201);
	});
	app.put("/agents/templates/:id", async c => {
		const input = definition(await c.req.json().catch(() => null), c.req.param("id"));
		if (!input) return c.json({ error: "template requires a name and valid optional configuration" }, 400);
		return c.json(saveAgentTemplate(input));
	});
	app.delete("/agents/templates/:id", c => removeAgentTemplate(c.req.param("id"))
		? c.json({ ok: true }) : c.json({ error: "template not found" }, 404));
	app.get("/agents/instances", c => c.json({ instances: instances(), capabilities: capabilities() }));
	app.get("/agents", c => c.json({ agents: instances(), capabilities: capabilities() }));
	app.post("/agents", c => c.json({ error: spawnReason, capability: "spawn", available: false }, 501));
	app.post("/agents/instances", c => c.json({ error: spawnReason, capability: "spawn", available: false }, 501));

	const find = (id: string, threadId?: string) => instances().find(row => row.id === id && (!threadId || row.sessionId === threadId));
	async function cancel(row: AgentInstance): Promise<void> {
		if (row.parentInstanceId === null) {
			const handle = bridge.getSession(row.sessionId);
			if (!handle) throw new Error("instance no longer active");
			await handle.abort();
		} else await bridge.abortSubagent(row.sessionId, row.id);
	}
	async function steer(row: AgentInstance, text: string, images?: ImageAttachment[]): Promise<void> {
		if (row.parentInstanceId === null) {
			const handle = bridge.getSession(row.sessionId);
			if (!handle || !handle.isStreamingNow()) throw new Error("Use the thread composer to start a new turn on an idle session.");
			await handle.prompt(text, { streamingBehavior: "steer", images });
		} else {
			if (images?.length) throw new Error("This SDK cannot attach images to child steering.");
			if (!bridge.steerSubagent) throw new Error("Child steering is unavailable on this backend.");
			await bridge.steerSubagent(row.sessionId, row.id, text);
		}
		bridge.bumpActivity(row.sessionId);
	}
	async function update(row: AgentInstance, body: unknown): Promise<string | undefined> {
		if (!object(body)) return "invalid json body";
		if (body.restrictions !== undefined) return "Runtime restrictions are not editable through this NeoPi SDK.";
		if (typeof body.model !== "string" || !body.model.trim()) return "model selector is required";
		if (row.parentInstanceId !== null) return "This SDK cannot change an existing child instance's model.";
		const handle = bridge.getSession(row.sessionId) as (SessionHandle & { setModelSelector?(selector: string): Promise<void> }) | undefined;
		if (!handle) return "instance no longer active";
		if (handle.setModelSelector) await handle.setModelSelector(body.model);
		else {
			const slash = body.model.indexOf("/");
			if (slash < 1 || body.model.startsWith("@") || body.model.includes(":")) return "Opaque model selectors need native selector support on this backend.";
			await handle.setModel({ provider: body.model.slice(0, slash), id: body.model.slice(slash + 1) });
		}
		return;
	}
	for (const prefix of ["/agents/instances/:id", "/agents/:id"]) {
		app.post(`${prefix}/steer`, async c => {
			const row = find(c.req.param("id")!);
			if (!row) return c.json({ error: "instance not found" }, 404);
			const body = await c.req.json().catch(() => null);
			if (!object(body) || typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text is required" }, 400);
			if (!row.actions.steer) return c.json({ error: "This instance does not permit steering." }, 409);
			try { await steer(row, body.text); return c.json({ ok: true }); }
			catch (error) { return c.json({ error: String(error) }, 409); }
		});
		for (const action of ["cancel", "stop"]) app.post(`${prefix}/${action}`, async c => {
			const row = find(c.req.param("id")!);
			if (!row) return c.json({ error: "instance not found" }, 404);
			if (!row.actions.cancel) return c.json({ error: "This instance does not permit cancellation." }, 409);
			try { await cancel(row); return c.json({ ok: true }); }
			catch (error) { return c.json({ error: String(error) }, 409); }
		});
		app.patch(prefix, async c => {
			const row = find(c.req.param("id")!);
			if (!row) return c.json({ error: "instance not found" }, 404);
			try { const error = await update(row, await c.req.json().catch(() => null)); return error ? c.json({ error }, 501) : c.json({ ok: true }); }
			catch (error) { return c.json({ error: String(error) }, 409); }
		});
	}
	app.get("/threads/:id/agents", c => {
		const id = c.req.param("id");
		if (!bridge.getSession(id)) return c.json({ error: "thread is not live; resume its session first" }, 404);
		return c.json({ agents: instances().filter(row => row.sessionId === id), capabilities: capabilities() });
	});
	app.post("/threads/:id/agents", c => c.json({ error: spawnReason, available: false }, 501));
	app.delete("/threads/:id/agents/:agentId", async c => {
		const row = find(c.req.param("agentId"), c.req.param("id"));
		if (!row) return c.json({ error: "instance not found in this thread" }, 404);
		if (!row.actions.cancel) return c.json({ error: "This instance does not permit cancellation." }, 409);
		try { await cancel(row); return c.json({ ok: true }); }
		catch (error) { return c.json({ error: String(error) }, 409); }
	});
	app.patch("/threads/:id/agents/:agentId", async c => {
		const row = find(c.req.param("agentId"), c.req.param("id"));
		if (!row) return c.json({ error: "instance not found in this thread" }, 404);
		try { const error = await update(row, await c.req.json().catch(() => null)); return error ? c.json({ error }, 501) : c.json({ ok: true }); }
		catch (error) { return c.json({ error: String(error) }, 409); }
	});
	app.post("/threads/:id/send", async c => {
		const body = await c.req.json().catch(() => null);
		if (!object(body) || typeof body.text !== "string" || !body.text.trim() || typeof body.to !== "string") return c.json({ error: "text and a target instance id are required" }, 400);
		if (body.to === "all") return c.json({ error: "Equal-participant broadcast waits for the neopi#11 conversation design.", available: false }, 501);
		if (body.images !== undefined) return c.json({ error: "Use the thread composer for image attachments." }, 501);
		const row = find(body.to, c.req.param("id"));
		if (!row) return c.json({ error: "instance not found in this thread" }, 404);
		if (!row.actions.steer) return c.json({ error: "This instance does not permit steering. Use the thread composer for a new turn." }, 409);
		try { await steer(row, body.text); return c.json({ ok: true }); }
		catch (error) { return c.json({ error: String(error) }, 409); }
	});
	app.get("/judge", c => c.json({ available: false, reason: judgeReason }));
	app.get("/judge/events", c => {
		const limit = Number(c.req.query("limit") ?? "50");
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return c.json({ error: "limit must be an integer between 1 and 500" }, 400);
		return c.json({ events: [], available: false, reason: judgeReason });
	});
	app.put("/judge", c => c.json({ error: judgeReason, available: false }, 501));
	app.post("/judge/events/:id/undo", c => c.json({ error: judgeReason + " " + spawnReason, available: false }, 501));
	return app;
}
