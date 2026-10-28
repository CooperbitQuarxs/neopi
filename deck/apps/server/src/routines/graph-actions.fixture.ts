/** Private subprocess fixture. Only external transport boundaries are simulated. */
import { Hono } from "hono";
import { openDb, closeDb } from "../db/index.ts";
import { RoutinesRunner } from "../routines-runner.ts";
import { buildRoutinesRouter } from "../routes-routines.ts";
import { notificationService } from "../notifications/service.ts";
import { githubIssueTransport } from "./github-issues.ts";

if (!process.env.NEODECK_ACTION_FIXTURE_DB) throw new Error("Explicit isolated fixture DB required");
openDb({ path: process.env.NEODECK_ACTION_FIXTURE_DB });
const messages: unknown[] = [], issues: unknown[] = [];
notificationService.register({ id: "isolated-recorder", deliver(envelope) { messages.push(envelope); return { status: "accepted", provider: "simulated", nativeId: "message-1" }; } });
githubIssueTransport.execute = async command => {
	if (!command.args.includes("POST")) throw new Error("Unexpected fixture provider read");
	const payload = JSON.parse(command.input!); issues.push(payload);
	return { exitCode: 0, stderr: "", stdout: `HTTP/2.0 201 Created\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ id: 8001, number: 81, html_url: "https://github.com/isolated-owner/disposable/issues/81", repository_url: "https://api.github.com/repos/isolated-owner/disposable", body: payload.body })}` };
};
const runner = new RoutinesRunner();
const app = new Hono().route("/api", buildRoutinesRouter(runner));
app.get("/simulated-effects", c => c.json({ messages, issues }));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
process.stdout.write(`${server.url.origin}\n`);
process.on("SIGTERM", async () => { await runner.dispose(); server.stop(true); closeDb(); process.exit(0); });
