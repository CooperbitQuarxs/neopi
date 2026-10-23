/**
 * What the office is doing right now, for the sidebar foot and the Today
 * strip: how many threads need you, how many agents are working, what is
 * waiting in review. Live parts come from the store (sessions); the agent
 * roster is preview until the agents endpoint exists (backend-contracts.md §4).
 */
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { PREVIEW_AGENTS, PREVIEW_WHEEL } from "./preview-data";

export interface Presence {
	needsYou: number;
	working: number;
	inReview: number;
}

export function usePresence(): Presence {
	const sessionsById = useStore((s) => s.sessionsById);
	return useMemo(() => {
		let needsYou = 0;
		let working = 0;
		for (const session of Object.values(sessionsById)) {
			if (session.status !== "idle") working++;
		}
		for (const agent of PREVIEW_AGENTS) {
			if (agent.state === "needs-you") needsYou++;
			if (agent.state === "working") working++;
		}
		return { needsYou, working, inReview: PREVIEW_WHEEL.filter((w) => w.stage === "review" || w.stage === "pr").length };
	}, [sessionsById]);
}
