import { sleepLong } from "@oh-my-pi/pi-utils";
import type { AgentSession } from "../session/agent-session";

export const DEFER_USAGE = "Usage: /defer <duration> <input> | /defer cancel <id|all>";

const UNITS: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
	M: 2_592_000_000,
	Y: 31_536_000_000,
};

export function parseDeferredInput(args: string): { delayMs: number; input: string } | undefined {
	const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(ms|s|m|h|d|w|M|Y)\s([\s\S]+)$/.exec(args);
	if (!match || !match[3].trim()) return undefined;
	const delayMs = Number(match[1]) * UNITS[match[2]];
	if (!Number.isFinite(delayMs)) return undefined;
	return { delayMs: Math.max(0, delayMs), input: match[3] };
}

/** Owns only cancellable clocks. Delivery still uses the composer's interpreter and AgentSession's queues. */
export class DeferredSubmissions {
	#nextId = 0;
	#timers = new Map<number, AbortController>();

	constructor(readonly session: AgentSession) {
		const unsubscribe = session.registerSessionChangeCallback(() => this.cancel());
		session.addDisposer(() => {
			this.cancel();
			unsubscribe();
		});
	}

	schedule(delayMs: number, submit: () => Promise<void>, onError: (error: unknown) => void): number {
		if (this.session.isDisposed) throw new Error("Cannot defer input after the session has ended");
		const id = ++this.#nextId;
		const controller = new AbortController();
		const sessionId = this.session.sessionManager.getSessionId();
		this.#timers.set(id, controller);
		void sleepLong(delayMs, controller.signal)
			.then(async () => {
				this.#timers.delete(id);
				if (
					controller.signal.aborted ||
					this.session.isDisposed ||
					this.session.sessionManager.getSessionId() !== sessionId
				)
					return;
				await submit();
			})
			.catch(error => {
				if (!controller.signal.aborted) onError(error);
			})
			.finally(() => this.#timers.delete(id));
		return id;
	}

	cancel(id?: number): number {
		if (id !== undefined) {
			const controller = this.#timers.get(id);
			if (!controller) return 0;
			controller.abort();
			this.#timers.delete(id);
			return 1;
		}
		const count = this.#timers.size;
		for (const controller of this.#timers.values()) controller.abort();
		this.#timers.clear();
		return count;
	}
}

const schedules = new WeakMap<AgentSession, DeferredSubmissions>();

export function deferredSubmissionsFor(session: AgentSession): DeferredSubmissions {
	let schedulesForSession = schedules.get(session);
	if (!schedulesForSession) {
		schedulesForSession = new DeferredSubmissions(session);
		schedules.set(session, schedulesForSession);
	}
	return schedulesForSession;
}
