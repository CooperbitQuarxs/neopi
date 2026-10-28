import type { RoutineBudget, RoutineConcurrency, RoutineLayoutNode } from "./index";

/** JSON values are transported intact. `object` ports accept every value type. */
export type GraphValue = null | boolean | number | string | GraphValue[] | GraphObject;
export interface GraphObject { [key: string]: GraphValue }
export type GraphValueType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface GraphPort {
	id: string;
	label?: string;
	type: GraphValueType;
	/** Input ports are required unless explicitly false. */
	required?: boolean;
	/** Accept multiple incoming edges/values instead of one. */
	multiple?: boolean;
}

/** Serializable catalogue entry shared by server validation and the canvas. */
export interface GraphNodeType {
	type: string;
	label: string;
	kind: "event" | "gate" | "operation" | "action";
	inputs: GraphPort[];
	outputs: GraphPort[];
	/** JSON Schema for config; enforced by the server registry. */
	configSchema?: GraphObject;
}

export const INBOX_CARD_ADDED_EVENT = "inbox.card_added";
export const inboxCardAddedNodeType: GraphNodeType = {
	type: INBOX_CARD_ADDED_EVENT,
	label: "inbox: card added",
	kind: "event",
	inputs: [],
	outputs: [{ id: "event", type: "object" }],
	configSchema: {
		type: "object",
		required: ["eventType"],
		properties: { eventType: { const: INBOX_CARD_ADDED_EVENT } },
		additionalProperties: false,
	},
};

export interface GraphNode {
	id: string;
	type: string;
	config: GraphObject;
}

export interface GraphEdge {
	id: string;
	from: { nodeId: string; port: string };
	to: { nodeId: string; port: string };
}

/** Native routine source of truth; edges, not layout or YAML, drive execution. */
export interface RoutineGraph {
	version: 2;
	nodes: GraphNode[];
	edges: GraphEdge[];
	concurrency?: RoutineConcurrency;
	budget?: RoutineBudget;
	/** Converted routine semantics, including native attempt accounting for V1. */
	execution?: { mode: "routine-v1" | "routine-v0" };
	timezone?: string;
	tags?: string[];
	layout?: { nodes?: Record<string, RoutineLayoutNode> };
}

export interface GraphActivation {
	eventType: string;
	event: GraphObject | GraphValue[];
	/** Select one source explicitly, otherwise activate sources matching eventType. */
	sourceNodeId?: string;
	/** Stable event/explicit operation identity; retries must retain it. */
	operationId?: string;
}

export interface GraphIterationAddress extends GraphObject { nodeId: string; index: number }

/**
 * Golden-rule envelope. Object results are retained under result without copying;
 * scalars and arrays become result.value. Inputs retain the same envelopes emitted
 * upstream, in incoming graph-edge order. Routing never rewrites a result to true.
 */
export interface GraphOutput {
	nodeId: string;
	port: string;
	result: GraphObject;
	inputs: GraphOutput[];
	/** Outer-to-inner iterator IDs and zero-based pass indexes. */
	iteration?: GraphIterationAddress[];
}

export interface GraphNodeInput {
	port: string;
	edgeId: string;
	output: GraphOutput;
}

/** Only named emitted ports activate consumers; un-emitted branches stay inactive. */
export interface GraphEmission {
	port: string;
	value: GraphValue;
	/** Use earlier same-batch outputs as inputs; they retain original inputs transitively. */
	includeSiblingOutputs?: string[];
}

export interface GraphEffect {
	logicalKey: string;
	status: "planned" | "confirmed" | "uncertain" | "rejected" | "not-dispatched";
	destination: GraphObject;
	request: GraphObject;
	receipt?: GraphObject;
	replayed: boolean;
}

export interface GraphNodeRun {
	nodeId: string;
	type: string;
	status: "success" | "skipped" | "failed" | "aborted";
	startedAt?: string;
	endedAt: string;
	inputs: GraphOutput[];
	/** Corresponds positionally to inputs. */
	inputPorts: string[];
	outputs: GraphOutput[];
	error?: string;
	effects?: GraphEffect[];
	/** Non-routing handler details, retained even when execution fails or aborts. */
	diagnostics?: GraphObject;
	iteration?: GraphIterationAddress[];
	/** Each body trace is scoped to its pass, including failed/aborted passes. */
	passes?: GraphIterationPass[];
}

export interface GraphIterationPass {
	index: number;
	status: GraphExecutionResult["status"];
	nodeRuns: GraphNodeRun[];
	outputs: GraphOutput[];
}

export interface GraphExecutionResult {
	status: "success" | "failed" | "aborted";
	nodeRuns: GraphNodeRun[];
	outputs: GraphOutput[];
	error?: string;
	abortReason?: "budget" | "cancelled" | "timeout" | "failure";
	usage?: {
		llmTokensIn: number;
		llmTokensOut: number;
		llmCostMicros: number;
		stepsExecuted: number;
	};
	dryRun?: boolean;
}

/** Persisted trace includes the definition actually executed, not its later edit. */
export interface GraphRunRecord extends GraphExecutionResult {
	id: string;
	routineId: string;
	startedAt: string;
	endedAt: string;
	activation: GraphActivation;
	graph: RoutineGraph;
}
