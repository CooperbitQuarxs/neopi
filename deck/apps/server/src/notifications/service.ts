/**
 * Deck notification service. Routes notification payloads to every
 * registered channel concurrently; isolates failures so one bad channel
 * never starves siblings.
 *
 * notify() preserves best-effort fan-out compatibility. preflight()/deliver()
 * target one explicitly registered channel and expose dispatch evidence.
 *
 * A payload whose `kind` is listed in `NPI_DECK_NOTIFICATIONS_DISABLED`
 * (Settings → Notifications) is dropped before any channel sees it. The
 * variable is read on every notify, so a Settings save applies at once.
 *
 * Channel handlers MUST be idempotent w.r.t. notification id: a transport
 * could deliver twice on reconnect; the channel decides how to dedupe (the
 * browser channel doesn't bother — clients ignore duplicate ids via the
 * `id` field on the wire frame).
 */

import { logger } from "../log.ts";
import { isNotificationKind, NOTIFICATIONS_DISABLED_ENV, parseDisabledKinds } from "./kinds.ts";
import type {
	NotificationChannel,
	NotificationDeliveryCode,
	NotificationDeliveryPreflight,
	NotificationDeliveryReceipt,
	NotificationEnvelope,
	NotificationPayload,
} from "./types.ts";

const log = logger("notifications");

/** Safe failure for callers deciding whether an external effect may be retried. */
export class NotificationDeliveryError extends Error {
	readonly outcome: "rejected" | "uncertain";

	constructor(
		readonly receipt: NotificationDeliveryReceipt & { status: "rejected" | "uncertain" },
	) {
		super(`Notification delivery ${receipt.status}: ${receipt.code}`);
		this.name = "NotificationDeliveryError";
		this.outcome = receipt.status;
	}
}

/** A channel may throw this only when it knows the provider did not accept. */
export class NotificationChannelRejectedError extends Error {
	constructor() {
		super("Notification channel rejected delivery");
		this.name = "NotificationChannelRejectedError";
	}
}

/** Runtime validation shared by graph preflight and live delivery. */
export function validateNotificationPayload(value: unknown): NotificationPayload {
	const invalid = (): never => {
		throw new NotificationDeliveryError({
			status: "rejected",
			destination: "",
			code: "invalid_payload",
		});
	};
	if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
	const input = value as Record<string, unknown>;
	const { kind, level, title, body, sound, source, actionUrl } = input;
	if (typeof kind !== "string" || !isNotificationKind(kind)) return invalid();
	if (level !== "info" && level !== "warn" && level !== "error" && level !== "critical") return invalid();
	if (typeof title !== "string" || title.trim().length === 0) return invalid();
	if (body !== undefined && typeof body !== "string") return invalid();
	if (sound !== undefined && typeof sound !== "boolean") return invalid();
	if (source !== undefined && typeof source !== "string") return invalid();
	if (actionUrl !== undefined && typeof actionUrl !== "string") return invalid();
	return {
		kind,
		level,
		title,
		...(body !== undefined ? { body } : {}),
		...(sound !== undefined ? { sound } : {}),
		...(source !== undefined ? { source } : {}),
		...(actionUrl !== undefined ? { actionUrl } : {}),
	};
}

export class NotificationService {
	private readonly channels = new Map<string, NotificationChannel>();

	/**
	 * Add a channel. If a channel with the same id is already registered, it
	 * is replaced — keeps test setup simple and lets later channels override
	 * earlier ones if needed.
	 */
	register(channel: NotificationChannel): void {
		if (this.channels.has(channel.id)) {
			log.warn(`replacing existing notification channel ${channel.id}`);
		}
		this.channels.set(channel.id, channel);
	}

	/** Unregister a channel by id. Returns true if it was present. */
	unregister(channelId: string): boolean {
		return this.channels.delete(channelId);
	}

	/** Channels currently registered. Stable iteration order = insertion order. */
	listChannels(): readonly string[] {
		return Array.from(this.channels.keys());
	}

	/**
	 * Side-effect-free availability check for exactly one registered channel.
	 * Browser readiness means only that its broadcast transport is registered:
	 * neither connected recipients nor permission/display are acknowledged.
	 */
	preflight(destination: string, payload: NotificationPayload): NotificationDeliveryPreflight {
		if (typeof destination !== "string" || destination.trim().length === 0) {
			return { destination: "", status: "rejected", code: "invalid_destination" };
		}
		let validated: NotificationPayload;
		try {
			validated = validateNotificationPayload(payload);
		} catch {
			return { destination, status: "rejected", code: "invalid_payload" };
		}
		if (parseDisabledKinds(process.env[NOTIFICATIONS_DISABLED_ENV]).has(validated.kind)) {
			return { destination, status: "disabled", code: "kind_disabled" };
		}
		const channel = this.channels.get(destination);
		if (!channel) return { destination, status: "no_target", code: "destination_unregistered" };
		try {
			const result = channel.preflight?.(validated);
			switch (result?.status) {
				case undefined:
				case "ready":
					return { destination, status: "ready" };
				case "disabled":
					return { destination, status: "disabled", code: "channel_disabled" };
				case "no_target":
					return { destination, status: "no_target", code: "channel_no_target" };
				case "rejected":
					return { destination, status: "rejected", code: "channel_rejected" };
				default:
					return { destination, status: "rejected", code: "preflight_failed" };
			}
		} catch {
			return { destination, status: "rejected", code: "preflight_failed" };
		}
	}

	/**
	 * Await exactly one channel, without best-effort fan-out or swallowed errors.
	 * Abort before dispatch prevents sending. After dispatch, await the actual
	 * outcome even if aborted: a late provider receipt is still durable evidence.
	 * An unclassified transport exception is uncertain, never proof of rejection.
	 */
	async deliver(
		destination: string,
		payload: NotificationPayload,
		signal?: AbortSignal,
	): Promise<NotificationDeliveryReceipt> {
		const checkAbort = (): void => {
			if (signal?.aborted) {
				throw new NotificationDeliveryError({
					destination,
					status: "rejected",
					code: "aborted_before_dispatch",
				});
			}
		};
		checkAbort();
		const preflight = this.preflight(destination, payload);
		if (preflight.status !== "ready") {
			return {
				destination: preflight.destination,
				status: preflight.status,
				code: preflight.code ?? "preflight_failed",
			};
		}
		// A channel's preflight can unregister itself. Recheck without dispatching.
		const channel = this.channels.get(destination);
		if (!channel) return { destination, status: "no_target", code: "destination_unregistered" };
		const validated = validateNotificationPayload(payload);
		const envelope: NotificationEnvelope = {
			...validated,
			sound: validated.sound ?? validated.level !== "info",
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
		};
		checkAbort();
		const identity = { destination, notificationId: envelope.id, timestamp: envelope.timestamp };
		try {
			const receipt = await channel.deliver(envelope, signal);
			// A legacy void channel has no acknowledgement, even if it returned.
			// Copy only public receipt fields, never an arbitrary provider response.
			return {
				...identity,
				status: receipt?.status === "accepted" ? "accepted" : "dispatched",
				...(receipt?.nativeId !== undefined ? { nativeId: receipt.nativeId } : {}),
				...(receipt?.receiptId !== undefined ? { receiptId: receipt.receiptId } : {}),
				...(receipt?.provider !== undefined ? { provider: receipt.provider } : {}),
			};
		} catch (error) {
			const rejected = error instanceof NotificationChannelRejectedError;
			const code: NotificationDeliveryCode = rejected ? "channel_rejected" : "dispatch_failed";
			throw new NotificationDeliveryError({
				...identity,
				status: rejected ? "rejected" : "uncertain",
				code,
			});
		}
	}

	/**
	 * Fire a notification across every channel. Resolves once all channels
	 * have either delivered or thrown, with the envelope they received, or
	 * null when the payload's kind is switched off. Caller is expected to
	 * fire-and-forget unless they specifically need to await delivery (e.g.
	 * test code).
	 */
	async notify(payload: NotificationPayload): Promise<NotificationEnvelope | null> {
		if (parseDisabledKinds(process.env[NOTIFICATIONS_DISABLED_ENV]).has(payload.kind)) {
			log.debug(`notify (${payload.kind} disabled): ${payload.level} ${payload.title}`);
			return null;
		}

		// Default sound: true for warn and above. Explicit false respected.
		const sound =
			payload.sound !== undefined
				? payload.sound
				: payload.level === "warn" || payload.level === "error" || payload.level === "critical";

		const envelope: NotificationEnvelope = {
			...payload,
			sound,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
		};

		if (this.channels.size === 0) {
			log.debug(`notify (no channels): ${envelope.level} ${envelope.title}`);
			return envelope;
		}

		await Promise.all(
			Array.from(this.channels.values()).map(async (channel) => {
				try {
					await channel.deliver(envelope);
				} catch (err) {
					log.warn(`notification channel ${channel.id} threw`, err);
				}
			}),
		);

		return envelope;
	}
}

/** Module-level singleton. Producers import this and call notify(). */
export const notificationService = new NotificationService();
