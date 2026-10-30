import { INBOX_CARD_ADDED_EVENT, type GraphObject, type InboxReceipt, type RoutineGraph } from "@npi-deck/protocol";
import { getDb } from "./db/index.ts";
import { getInbox, updateInbox } from "./db/inbox.ts";
import { recordInboxReceipt } from "./db/inbox-routing.ts";
import { createGraphRoutine, DEFAULT_INBOX_TICKET_ROUTINE_ID, getRoutine } from "./db/routines.ts";
import { getGraphEffect } from "./db/graph-actions.ts";
import type { GraphNodeRegistry } from "./routines/graph-runner.ts";
import { validateGithubIssueRequest } from "./routines/github-issues.ts";

export function parseInboxRepository(repository: string): { host: string; owner: string; repo: string } {
	const parts = repository.trim().toLowerCase().split("/");
	if (parts.length === 2) parts.unshift("github.com");
	if (parts.length !== 3) throw new Error("Use owner/repository or host/owner/repository.");
	const [host, owner, repo] = parts as [string, string, string];
	validateGithubIssueRequest({ host, owner, repo, title: "Validate repository", body: "", operationId: "validate" });
	return { host, owner, repo };
}

export function defaultInboxGraph(repository = ""): RoutineGraph {
	const from = (nodeId: string, ...path: string[]) => ({ $from: { nodeId, path: ["result", ...path] } });
	return {
		version: 2, concurrency: "parallel",
		nodes: [
			{ id: "inbox", type: INBOX_CARD_ADDED_EVENT, config: { eventType: INBOX_CARD_ADDED_EVENT } },
			{ id: "ticket", type: "gate.compare", config: { path: ["result", "kind"], operator: "eq", right: "ticket" } },
			{ id: "route", type: "operation.inbox-route", config: { repository } },
			{ id: "file", type: "action.file-issue", config: { request: {
				host: from("route", "host"), owner: from("route", "owner"), repo: from("route", "repo"),
				title: from("inbox", "title"), body: from("inbox", "body"), labels: ["needs-triage"],
			} } },
			{ id: "acknowledge", type: "action.ack-inbox", config: {} },
		],
		edges: [
			{ id: "kind", from: { nodeId: "inbox", port: "event" }, to: { nodeId: "ticket", port: "input" } },
			{ id: "tickets", from: { nodeId: "ticket", port: "true" }, to: { nodeId: "route", port: "in" } },
			{ id: "repository", from: { nodeId: "route", port: "route" }, to: { nodeId: "file", port: "in" } },
			{ id: "receipt", from: { nodeId: "file", port: "result" }, to: { nodeId: "acknowledge", port: "in" } },
		],
	};
}

/** Persist once, never overwrite a disabled or edited default on restart. */
export function installDefaultInboxFlow(registry: GraphNodeRegistry): void {
	if (getRoutine(DEFAULT_INBOX_TICKET_ROUTINE_ID)) return;
	createGraphRoutine({ id: DEFAULT_INBOX_TICKET_ROUTINE_ID, name: "Inbox tickets to GitHub", description: "Only original tickets file automatically. Configure a repository before filing.", graph: defaultInboxGraph(), enabled: true }, registry);
}

export function registerInboxFlowNodes(registry: GraphNodeRegistry): void {
	registry.register({
		definition: {
			type: "operation.inbox-route", label: "Route inbox ticket", kind: "operation",
			inputs: [{ id: "in", type: "object", required: true }], outputs: [{ id: "route", type: "object" }],
			configSchema: { type: "object", required: ["repository"], properties: { repository: { type: "string" } }, additionalProperties: false },
		},
		execute: ({ node, activation, rootActivation }) => {
			const original = (rootActivation ?? activation).event;
			if (Array.isArray(original) || original.kind !== "ticket") throw new Error("Only an original inbox ticket can use this route.");
			if (!node.config.repository) return [];
			return [{ port: "route", value: { ...parseInboxRepository(node.config.repository as string), configured: true, routing: "explicit repository", originalKind: original.kind } }];
		},
	});
	registry.register({
		definition: {
			type: "action.ack-inbox", label: "Acknowledge inbox filing", kind: "action",
			inputs: [{ id: "in", type: "object", required: true }], outputs: [{ id: "result", type: "object" }],
			configSchema: { type: "object", additionalProperties: false },
		},
		execute: context => {
			const original = (context.rootActivation ?? context.activation).event;
			if (Array.isArray(original) || typeof original.id !== "string") throw new Error("Inbox acknowledgement requires the original item identity.");
			const input = context.inputs[0]!.output.result;
			if (context.dryRun && input.status === "planned") return [{ port: "result", value: { status: "planned", itemId: original.id } }];
			if (input.status !== "confirmed" || typeof input.logicalKey !== "string") throw new Error("Inbox acknowledgement requires a confirmed issue effect.");
			const effect = getGraphEffect(input.logicalKey);
			const accepted = effect?.receipt;
			const issue = accepted?.issue as GraphObject | undefined;
			if (effect?.status !== "confirmed" || typeof accepted?.repository !== "string" || typeof issue?.number !== "number" || typeof issue.url !== "string") throw new Error("Confirmed issue receipt missing.");
			const receipt: InboxReceipt = { kind: "issue", ref: `${accepted.repository}#${issue.number}`, label: `${accepted.repository}#${issue.number}`, url: issue.url, repository: accepted.repository, issueNumber: issue.number, logicalKey: effect.logicalKey };
			getDb().transaction(() => {
				if (!getInbox(original.id as string)) throw new Error("Inbox item no longer exists.");
				recordInboxReceipt(original.id as string, { kind: "issue", repo: `${effect.destination.host}/${effect.destination.owner}/${effect.destination.repo}` }, receipt);
				updateInbox(original.id as string, { processed: true });
			})();
			return [{ port: "result", value: { ...receipt, itemId: original.id } }];
		},
	});
}
