/**
 * Browser notification channel. Pushes notifications to every connected web
 * client by broadcasting a `notification` ServerFrame over the shared
 * BroadcastBus. The web layer renders the OS-level `Notification` (when
 * permission is granted) and optionally plays an audio cue.
 *
 * No state, no buffering — if no clients are connected, the frame is fanned
 * out to zero subscribers and the notification is effectively dropped. The
 * inbox is the persistent log; notifications are transient pings.
 */

import { broadcastBus } from "../../broadcast-bus.ts";
import type {
	NotificationChannel,
	NotificationChannelPreflight,
	NotificationChannelReceipt,
	NotificationEnvelope,
} from "../types.ts";

export class BrowserNotificationChannel implements NotificationChannel {
	readonly id = "browser";

	/** Broadcast registration cannot establish recipient presence or permission. */
	preflight(): NotificationChannelPreflight {
		return { status: "ready" };
	}

	deliver(envelope: NotificationEnvelope): NotificationChannelReceipt {
		broadcastBus.broadcast({
			type: "notification",
			id: envelope.id,
			kind: envelope.kind,
			level: envelope.level,
			title: envelope.title,
			...(envelope.body !== undefined ? { body: envelope.body } : {}),
			...(envelope.sound !== undefined ? { sound: envelope.sound } : {}),
			...(envelope.source !== undefined ? { source: envelope.source } : {}),
			...(envelope.actionUrl !== undefined ? { actionUrl: envelope.actionUrl } : {}),
			timestamp: envelope.timestamp,
		});
		// The bus deliberately isolates listener failures; this is dispatch only.
		return { status: "dispatched" };
	}
}
