/**
 * The operator — the human at this process's interactive UI — as an IRC
 * participant (issue #31). She has her own id, distinct from `Main` (the model
 * that owns the composer): agents address her directly, and what she sends is
 * `from` her, never forged as `Main`. Delivery to her needs no model turn; the
 * bus shows it on her UI and records it in the operator history.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { AgentRegistry } from "../registry/agent-registry";

/** The operator's IRC id unless `irc.operator.handle` names another. */
export const DEFAULT_IRC_OPERATOR_HANDLE = "Operator";

/**
 * Register `handle` as the operator under `rootId`. Returns the unregister, or
 * undefined when another participant already holds that id (the operator then
 * stays unaddressable rather than shadowing an agent).
 */
export function registerIrcOperator(registry: AgentRegistry, handle: string, rootId: string): (() => void) | undefined {
	if (registry.get(handle)) {
		logger.warn("IRC operator handle is taken; the operator is not addressable", { handle });
		return undefined;
	}
	const ref = registry.register({
		id: handle,
		displayName: handle,
		kind: "operator",
		parentId: rootId,
		session: null,
		status: "idle",
	});
	return () => {
		registry.unregister(handle, ref);
	};
}
