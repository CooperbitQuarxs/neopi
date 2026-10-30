import type { StoredChange } from "./database";
import { SwitchError } from "./error";
import type { SwitchStore } from "./store";
import type { AdminActor, AdminAuthentication } from "./admin-auth";

const encoder = new TextEncoder();
const MAX_BUFFER = 256;

function frame(change: StoredChange): Uint8Array {
	return encoder.encode(
		`id: ${change.frame.cursor}\nevent: ${change.kind}\ndata: ${JSON.stringify(change.frame)}\n\n`,
	);
}

/** Subscribe/high-water capture precedes the first byte; later rows queue until replay ends. */
export function adminEventsStream(
	store: SwitchStore,
	cursor: string,
	actor: AdminActor,
	token: string | null,
	authentication: () => AdminAuthentication,
): Response {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	let heartbeat: Timer | undefined;
	let drain: Timer | undefined;
	const queue: StoredChange[] = [];
	let replay: StoredChange[] = [];
	let replayIndex = 0;
	let closed = false;
	const cleanup = () => {
		if (closed) return;
		closed = true;
		subscription?.close();
		if (heartbeat) clearInterval(heartbeat);
		if (drain) clearInterval(drain);
		queue.length = 0;
		replay.length = 0;
	};
	const resync = (reason: string) => {
		if (!controller || closed) return;
		controller.enqueue(encoder.encode(`event: resync\ndata: ${JSON.stringify({ reason })}\n\n`));
		cleanup();
		controller.close();
	};
	const stillAuthorized = () => {
		try {
			const current = authentication().authenticate(token);
			return current.name === actor.name && current.role === actor.role;
		} catch {
			return false;
		}
	};
	const flush = () => {
		if (!controller || closed) return;
		if (!stillAuthorized()) {
			resync("operator_authority_changed");
			return;
		}
		try {
			while ((controller.desiredSize ?? 0) > 0) {
				if (position < highWater) {
					if (replayIndex === replay.length) {
						// Keep one bounded page; encode only when the reader has capacity.
						replay = subscription.replay(position, MAX_BUFFER);
						replayIndex = 0;
						if (!replay.length)
							throw new SwitchError(409, "resync_required", "Replay no longer contains the requested rows");
					}
					const change = replay[replayIndex++]!;
					controller.enqueue(frame(change));
					position = change.seq;
					if (position === highWater) {
						replay.length = 0;
						replayIndex = 0;
					}
				} else {
					if (!queue.length) break;
					controller.enqueue(frame(queue.shift()!));
				}
			}
		} catch {
			resync("replay_expired");
		}
	};
	const onLive = (change: StoredChange) => {
		if (closed) return;
		if (!stillAuthorized()) {
			resync("operator_authority_changed");
			return;
		}
		if (queue.length >= MAX_BUFFER) {
			resync("buffer_exhausted");
			return;
		}
		queue.push(change);
		flush();
	};
	const subscription = store.subscribe(cursor, onLive);
	const highWater = subscription.highWater;
	let position = subscription.after;
	const stream = new ReadableStream<Uint8Array>({
		start(writable) {
			controller = writable;
			flush();
			if (closed) return;
			drain = setInterval(flush, 100);
			heartbeat = setInterval(() => {
				if (!stillAuthorized()) {
					resync("operator_authority_changed");
					return;
				}
				if (position < highWater || queue.length || (writable.desiredSize ?? 0) <= 0) return;
				writable.enqueue(encoder.encode(": heartbeat\n\n"));
			}, 15_000);
		},
		pull() {
			flush();
		},
		cancel() {
			cleanup();
		},
	});
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Accel-Buffering": "no",
		},
	});
}
