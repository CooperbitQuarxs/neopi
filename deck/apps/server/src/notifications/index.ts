/**
 * Public entry point for the notification service. Producers (v1-runner,
 * route handlers, future bridges) import from here only:
 *
 *   import { notificationService } from "./notifications/index.ts";
 *   await notificationService.notify({ level: "error", title: "..." });
 *
 * Channel implementations live under `./channels/`. Boot wiring in
 * `index.ts` registers default channels once.
 */

export {
	notificationService,
	NotificationService,
	NotificationDeliveryError,
	NotificationChannelRejectedError,
	validateNotificationPayload,
} from "./service.ts";
export { BrowserNotificationChannel } from "./channels/browser.ts";
export type {
	NotificationChannel,
	NotificationChannelPreflight,
	NotificationChannelReceipt,
	NotificationDeliveryCode,
	NotificationDeliveryPreflight,
	NotificationDeliveryReceipt,
	NotificationEnvelope,
	NotificationLevel,
	NotificationPayload,
} from "./types.ts";
