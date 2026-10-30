/**
 * The start of the routine on the canvas: what makes it run. One pill-shaped
 * node above the first step, connected to every root step. Selecting it
 * opens the trigger editor in the inspector; it cannot be dragged, deleted
 * or wired by hand.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Clock, Play, Webhook, Zap } from "lucide-react";
import { memo } from "react";

import type { RoutineTrigger } from "@npi-deck/protocol";

import { describeTrigger } from "../../trigger-summary";

export interface TriggerNodeData extends Record<string, unknown> {
	triggers: RoutineTrigger[];
	problem?: string;
}

export type TriggerNode = Node<TriggerNodeData, "trigger">;

export const TRIGGER_NODE_ID = "__trigger";

const KIND_ICON = { cron: Clock, webhook: Webhook, manual: Play, event: Zap } as const;

export const TriggerNodeView = memo(function TriggerNodeView({ data, selected }: NodeProps<TriggerNode>) {
	const summaries = data.triggers.map(describeTrigger);
	const first = summaries[0];
	const Icon = first ? KIND_ICON[first.kind] : Zap;
	const extra = summaries.length - 1;
	return (
		<div
			className="neo-node"
			data-kind="trigger"
			data-selected={selected ? "true" : undefined}
			data-problem={data.problem ? "true" : undefined}
			title={data.problem ?? summaries.map((s) => s.text).join("\n")}
			data-testid="trigger-node"
		>
			<div className="neo-node-head">
				<span className="neo-node-icon">
					<Icon size={13} />
				</span>
				<div className="neo-node-titles">
					<div className="neo-node-title" data-mono={first?.mono || undefined}>
						{first ? <span className={first.mono ? "neo-mono" : undefined}>{first.text}</span> : "No trigger yet"}
						{extra > 0 ? <span className="text-ink-3"> +{extra}</span> : null}
					</div>
					<div className="neo-node-kicker">{data.problem ?? (first ? KIND_WORDS[first.kind] : "Select to choose how this routine starts")}</div>
				</div>
			</div>
			<Handle type="source" position={Position.Bottom} isConnectable={false} />
		</div>
	);
});

const KIND_WORDS = { cron: "Schedule", webhook: "Webhook", manual: "Manual", event: "Event" } as const;
