import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { ConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import type { AgentSession } from "../session/agent-session";
import { FAST_USAGE, runFastCommand } from "../session/fast-command";

/** Apply an exact supported selection without silently clamping a captured task effort cap. */
export function setSubagentThinkingLevel(session: AgentSession, level: ThinkingLevel): string | undefined {
	const selectable = session.getAvailableEffortSelectors();
	const available: ThinkingLevel[] = [
		ThinkingLevel.Off,
		...session.getAvailableThinkingLevels().filter(candidate => selectable.includes(candidate)),
	];
	if (!available.includes(level)) {
		return `Unsupported thinking level ${JSON.stringify(level)}. Available levels: ${available.join(", ")}.`;
	}
	// persist=false skips global defaults, not the session's thinking_level_change journal entry.
	session.setThinkingLevel(level);
	return undefined;
}

export function cycleSubagentThinkingLevel(session: AgentSession): ConfiguredThinkingLevel | undefined {
	return session.cycleThinkingLevel();
}

/** Session-only tier mutation; enabled and actually active remain separate session facts. */
export function setSubagentFast(session: AgentSession, enabled: boolean): boolean {
	return session.setFastMode(enabled);
}

export function runSubagentFastCommand(session: AgentSession, args: string): string {
	const result = runFastCommand(args.trim().toLowerCase(), session);
	if (!result) throw new Error(FAST_USAGE);
	if (!result.success) throw new Error(result.message);
	return result.message;
}
