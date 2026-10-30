import type { GraphEffect, InboxItem, InboxReceipt } from "@npi-deck/protocol";
import { getDb } from "./db/index.ts";
import { updateInbox } from "./db/inbox.ts";
import { inboxFiling, recordInboxReceipt, releaseInboxFiling, reserveInboxFiling } from "./db/inbox-routing.ts";
import { GraphNodeRegistry } from "./routines/graph-runner.ts";
import { registerGraphActions } from "./routines/graph-actions.ts";
import { validateGithubIssueRequest, type GithubIssueReceipt } from "./routines/github-issues.ts";
import { parseInboxRepository } from "./inbox-flow.ts";
import { getGraphEffect, graphDigest } from "./db/graph-actions.ts";

const registry = new GraphNodeRegistry();
registerGraphActions(registry);

/** Use the same provider journal and uncertain-acceptance reconciliation as Studio. */
export async function fileInboxIssue(item: InboxItem, repository: string, dryRun: boolean, signal: AbortSignal) {
	const { host, owner, repo } = parseInboxRepository(repository);
	const destination = { kind: "issue" as const, repo: `${host}/${owner}/${repo}` };
	const requestFor = (capture: InboxItem) => ({
		host, owner, repo, title: capture.title, body: capture.body,
	});
	validateGithubIssueRequest({ ...requestFor(item), operationId: item.id });
	if (!dryRun) {
		item = reserveInboxFiling(item, destination);
		const prior = inboxFiling(item.id);
		if (prior) { updateInbox(item.id, { processed: true }); return { receipt: prior.receipt }; }
	}
	const request = requestFor(item);
	// Recovery reuses the graph's exact request, including its configured labels.
	const priorEffect = !dryRun ? getGraphEffect(graphDigest({ eventType: "inbox.file", operation: item.id })) : undefined;
	if (priorEffect) {
		const { operationId: _operationId, ...savedRequest } = priorEffect.request;
		validateGithubIssueRequest({ ...savedRequest, operationId: item.id });
		Object.assign(request, savedRequest);
	}
	const effects: GraphEffect[] = [];
	try {
		await registry.get("action.file-issue")!.execute({
			node: { id: "file", type: "action.file-issue", config: { request } }, inputs: [],
			activation: { eventType: "inbox.file", event: { id: item.id } },
			routineId: "inbox-filing", runId: `inbox-${item.id}`, dryRun, signal,
			recordEffect: effect => { effects.push(effect); },
			recordUsage: () => { throw new Error("Inbox issue filing cannot run inference"); },
		});
		if (dryRun) return { plan: { destination, title: request.title, body: request.body } };
		const effect = effects.at(-1);
		if (effect?.status !== "confirmed" || !effect.receipt) throw new Error("GitHub acceptance is unresolved. Retry this destination to reconcile it.");
		const accepted = effect.receipt as unknown as GithubIssueReceipt;
		const receipt: InboxReceipt = { kind: "issue", ref: `${accepted.repository}#${accepted.issue.number}`, url: accepted.issue.url, label: `${accepted.repository}#${accepted.issue.number}`, repository: accepted.repository, issueNumber: accepted.issue.number, logicalKey: effect.logicalKey };
		return getDb().transaction(() => {
			recordInboxReceipt(item.id, destination, receipt);
			updateInbox(item.id, { processed: true });
			return { receipt };
		})();
	} catch (error) {
		const status = effects.at(-1)?.status;
		// Proven rejection permits another destination. Uncertain writes stay reserved.
		if (!dryRun && (status === "rejected" || status === "not-dispatched")) releaseInboxFiling(item.id, destination);
		throw error;
	}
}
