import type { AgentSession } from "../../session/agent-session";
import type { RpcSessionState } from "./rpc-types";

/** Bounded reads of native policy and the journal index, never the visible transcript. */
export function rpcSessionTelemetry(session: AgentSession): Pick<RpcSessionState, "approvalMode" | "sessionUsage"> {
	return {
		approvalMode: session.getApprovalMode(),
		sessionUsage: {
			...session.sessionManager.getUsageStatistics(),
			advisorCost: session.getAdvisorCost(),
			advisorCostState: session.advisorCostRestoreState,
		},
	};
}
