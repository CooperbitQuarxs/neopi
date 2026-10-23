import type { GraphNode, RoutineGraph } from "@npi-deck/protocol";

/** A routine has one credential row; graph validation rejects multiple registered hooks. */
export function graphWebhookSource(graph: RoutineGraph | undefined): GraphNode | undefined {
	return graph?.nodes.find((node) => {
		const webhook = node.config.webhook;
		return node.type === "event.source" && node.config.eventType === "webhook"
			&& webhook !== null && typeof webhook === "object" && !Array.isArray(webhook)
			&& typeof webhook.path === "string";
	});
}

export function graphWebhookPath(graph: RoutineGraph | undefined): string | undefined {
	return (graphWebhookSource(graph)?.config.webhook as { path: string } | undefined)?.path;
}
