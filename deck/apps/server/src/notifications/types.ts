/**
 * Internal types for the deck's notification service. The wire-level shape
 * (`NotificationPayload`, `NotificationLevel`) is re-exported from
 * `@npi-deck/protocol` so producers don't import server-internal modules.
 */

import type { NotificationLevel, NotificationPayload } from "@npi-deck/protocol";

export type { NotificationLevel, NotificationPayload };

/**
 * A pluggable delivery target. Each channel must accept a payload and route
 * it however it likes (WS frame, HTTP POST to Telegram, SMTP send, etc).
 *
 * Legacy notify() isolates and logs errors. Awaited deliver() instead exposes
 * rejection or uncertainty to the caller; a void return proves dispatch only.
 */
export interface NotificationChannel {
	readonly id: string;
	/** Optional synchronous, side-effect-free destination availability check. */
	preflight?(payload: NotificationPayload): NotificationChannelPreflight;
	deliver(
		envelope: NotificationEnvelope,
		signal?: AbortSignal,
	): Promise<NotificationChannelReceipt | void> | NotificationChannelReceipt | void;
}

/**
 * Channel-facing payload: the user-supplied fields plus identifiers the
 * service assigns at notify time. Channels see the same struct regardless of
 * who produced the notification.
 */
export interface NotificationEnvelope extends NotificationPayload {
	/** Unique notification id, stable across channels. UUID v4 by default. */
	id: string;
	/** Wall-clock timestamp the notification was emitted, ISO 8601. */
	timestamp: string;
}

/** No provider or recipient acknowledgement is implied by `dispatched`. */
export interface NotificationChannelReceipt {
	status: "dispatched" | "accepted";
	/** Channel-supplied public identities only; never credentials or raw responses. */
	nativeId?: string;
	receiptId?: string;
	provider?: string;
}

export type NotificationChannelPreflight =
	| { status: "ready" }
	| { status: "disabled" | "no_target" | "rejected" };

export type NotificationDeliveryCode =
	| "invalid_payload"
	| "invalid_destination"
	| "kind_disabled"
	| "destination_unregistered"
	| "channel_disabled"
	| "channel_no_target"
	| "channel_rejected"
	| "preflight_failed"
	| "aborted_before_dispatch"
	| "dispatch_failed";

export interface NotificationDeliveryPreflight {
	destination: string;
	status: "ready" | "disabled" | "no_target" | "rejected";
	code?: NotificationDeliveryCode;
}

/** JSON receipt: a local notification UUID is correlation, not acceptance. */
export type NotificationDeliveryReceipt =
	| (NotificationChannelReceipt & {
			destination: string;
			notificationId: string;
			timestamp: string;
	  })
	| {
			destination: string;
			status: "disabled" | "no_target" | "rejected" | "uncertain";
			code: NotificationDeliveryCode;
			notificationId?: string;
			timestamp?: string;
	  };
