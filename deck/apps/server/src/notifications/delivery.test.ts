import { describe, expect, test } from "bun:test";

import { broadcastBus, type BroadcastFrame } from "../broadcast-bus.ts";
import { BrowserNotificationChannel } from "./channels/browser.ts";
import { NOTIFICATIONS_DISABLED_ENV } from "./kinds.ts";
import {
	NotificationChannelRejectedError,
	NotificationDeliveryError,
	NotificationService,
	validateNotificationPayload,
} from "./service.ts";
import type {
	NotificationChannelPreflight,
	NotificationChannelReceipt,
	NotificationEnvelope,
	NotificationPayload,
} from "./types.ts";

const payload: NotificationPayload = { kind: "routine_failed", level: "warn", title: "Run failed" };

describe("awaited notification delivery", () => {
	test("validates payload fields and copies only notification fields", () => {
		expect(validateNotificationPayload({
			...payload,
			body: "details",
			sound: false,
			source: "graph:run",
			actionUrl: "/tasks",
			id: "not-an-acceptance-receipt",
		})).toEqual({ ...payload, body: "details", sound: false, source: "graph:run", actionUrl: "/tasks" });
		for (const value of [
			null,
			[],
			{},
			{ ...payload, kind: "unknown" },
			{ ...payload, level: "fatal" },
			{ ...payload, title: " " },
			{ ...payload, body: 3 },
			{ ...payload, sound: "yes" },
			{ ...payload, source: false },
			{ ...payload, actionUrl: {} },
		]) {
			expect(() => validateNotificationPayload(value)).toThrow(NotificationDeliveryError);
		}
	});

	test("preflight rejects malformed payloads and unregistered destinations without sending", async () => {
		const service = new NotificationService();
		const received: NotificationEnvelope[] = [];
		service.register({ id: "recording", deliver: (envelope) => { received.push(envelope); } });
		expect(service.preflight("", payload)).toEqual({
			destination: "", status: "rejected", code: "invalid_destination",
		});
		expect(service.preflight("recording", { ...payload, title: "" })).toEqual({
			destination: "recording", status: "rejected", code: "invalid_payload",
		});
		expect(await service.deliver("telegram", payload)).toEqual({
			destination: "telegram", status: "no_target", code: "destination_unregistered",
		});
		expect(received).toHaveLength(0);
	});

	test("disabled kinds have explicit receipts and never reach a channel", async () => {
		const previous = process.env[NOTIFICATIONS_DISABLED_ENV];
		try {
			process.env[NOTIFICATIONS_DISABLED_ENV] = payload.kind;
			let attempts = 0;
			const service = new NotificationService();
			service.register({ id: "recording", deliver: () => { attempts++; } });
			expect(service.preflight("recording", payload)).toEqual({
				destination: "recording", status: "disabled", code: "kind_disabled",
			});
			expect(await service.deliver("recording", payload)).toEqual({
				destination: "recording", status: "disabled", code: "kind_disabled",
			});
			expect(attempts).toBe(0);
		} finally {
			if (previous === undefined) delete process.env[NOTIFICATIONS_DISABLED_ENV];
			else process.env[NOTIFICATIONS_DISABLED_ENV] = previous;
		}
	});

	test("channel preflight exposes disabled, no-target, and rejected destinations", async () => {
		for (const status of ["disabled", "no_target", "rejected"] as const) {
			let attempts = 0;
			const service = new NotificationService();
			service.register({
				id: "provider",
				preflight: (): NotificationChannelPreflight => ({ status }),
				deliver: () => { attempts++; },
			});
			expect(service.preflight("provider", payload).status).toBe(status);
			expect(await service.deliver("provider", payload)).toEqual({
				destination: "provider", status, code: `channel_${status}`,
			});
			expect(attempts).toBe(0);
		}
	});

	test("preflight exceptions are definite non-dispatch without exposing transport errors", async () => {
		const service = new NotificationService();
		let attempts = 0;
		service.register({
			id: "provider",
			preflight: () => { throw new Error("credential=private"); },
			deliver: () => { attempts++; },
		});
		expect(await service.deliver("provider", payload)).toEqual({
			destination: "provider", status: "rejected", code: "preflight_failed",
		});
		expect(attempts).toBe(0);
	});

	test("dispatches only the selected channel and does not treat its UUID as acknowledgement", async () => {
		const service = new NotificationService();
		const selected: NotificationEnvelope[] = [];
		const other: NotificationEnvelope[] = [];
		service.register({ id: "selected", deliver: (envelope) => { selected.push(envelope); } });
		service.register({ id: "other", deliver: (envelope) => { other.push(envelope); } });
		expect(service.preflight("selected", payload)).toEqual({ destination: "selected", status: "ready" });
		expect(selected).toHaveLength(0);
		const receipt = await service.deliver("selected", { ...payload, sound: false });
		expect(receipt).toEqual({
			destination: "selected",
			status: "dispatched",
			notificationId: selected[0]?.id,
			timestamp: selected[0]?.timestamp,
		});
		expect(selected).toHaveLength(1);
		expect(selected[0]?.sound).toBe(false);
		expect(other).toHaveLength(0);
		expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
	});

	test("browser uses the real broadcast channel and reports dispatch, never recipient acknowledgement", async () => {
		const service = new NotificationService();
		service.register(new BrowserNotificationChannel());
		const frames: BroadcastFrame[] = [];
		const dispose = broadcastBus.subscribe((frame) => { frames.push(frame); });
		try {
			const receipt = await service.deliver("browser", payload);
			expect(receipt.status).toBe("dispatched");
			expect(frames).toHaveLength(1);
			expect(frames[0]).toMatchObject({ type: "notification", title: payload.title, sound: true });
		} finally {
			dispose();
		}
		// The bus does not expose connected recipient counts. No listeners is
		// indistinguishable from delivery to the hub, not provider acceptance.
		expect((await service.deliver("browser", payload)).status).toBe("dispatched");
	});

	test("awaits provider acceptance and preserves only public native receipt identities", async () => {
		const service = new NotificationService();
		const delivery = Promise.withResolvers<NotificationChannelReceipt>();
		service.register({ id: "provider", deliver: () => delivery.promise });
		const pending = service.deliver("provider", payload);
		delivery.resolve({ status: "accepted", nativeId: "message-42", receiptId: "receipt-9", provider: "push" });
		const receipt = await pending;
		expect(receipt).toMatchObject({
			destination: "provider", status: "accepted", nativeId: "message-42", receiptId: "receipt-9", provider: "push",
		});
		expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
	});

	test("abort before dispatch is definite rejection and never sends", async () => {
		const service = new NotificationService();
		let attempts = 0;
		service.register({ id: "provider", deliver: () => { attempts++; } });
		const controller = new AbortController();
		controller.abort(new Error("sensitive reason"));
		await expect(service.deliver("provider", payload, controller.signal)).rejects.toMatchObject({
			name: "NotificationDeliveryError", outcome: "rejected",
			receipt: { destination: "provider", status: "rejected", code: "aborted_before_dispatch" },
		});
		expect(attempts).toBe(0);
	});

	test("abort from preflight is checked again before dispatch", async () => {
		const service = new NotificationService();
		const controller = new AbortController();
		let attempts = 0;
		service.register({
			id: "provider",
			preflight: () => { controller.abort(); return { status: "ready" }; },
			deliver: () => { attempts++; },
		});
		await expect(service.deliver("provider", payload, controller.signal)).rejects.toMatchObject({
			outcome: "rejected", receipt: { code: "aborted_before_dispatch" },
		});
		expect(attempts).toBe(0);
	});

	test("abort after dispatch does not discard a late acceptance receipt", async () => {
		const service = new NotificationService();
		const controller = new AbortController();
		const delivery = Promise.withResolvers<NotificationChannelReceipt>();
		let attempts = 0;
		service.register({
			id: "provider",
			deliver: (_envelope, signal) => {
				attempts++;
				expect(signal).toBe(controller.signal);
				return delivery.promise;
			},
		});
		const pending = service.deliver("provider", payload, controller.signal);
		controller.abort();
		delivery.resolve({ status: "accepted", nativeId: "late-message" });
		expect(await pending).toMatchObject({ status: "accepted", nativeId: "late-message" });
		expect(attempts).toBe(1);
	});

	test("unclassified failures after dispatch are uncertain and redact secret error details", async () => {
		const service = new NotificationService();
		const controller = new AbortController();
		const delivery = Promise.withResolvers<NotificationChannelReceipt>();
		service.register({ id: "provider", deliver: () => delivery.promise });
		const pending = service.deliver("provider", payload, controller.signal);
		controller.abort();
		delivery.reject(new Error("provider URL?token=private"));
		const error = await pending.catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(NotificationDeliveryError);
		if (!(error instanceof NotificationDeliveryError)) throw new Error("missing delivery error");
		expect(error.outcome).toBe("uncertain");
		expect(error.receipt).toMatchObject({ destination: "provider", status: "uncertain", code: "dispatch_failed" });
		expect(error.receipt.notificationId).toBeDefined();
		expect(`${error}${JSON.stringify(error)}`).not.toContain("private");
	});

	test("synchronous transport exceptions are uncertain, not false definite rejections", async () => {
		const service = new NotificationService();
		service.register({ id: "provider", deliver: () => { throw new Error("connection closed"); } });
		await expect(service.deliver("provider", payload)).rejects.toMatchObject({
			outcome: "uncertain", receipt: { status: "uncertain", code: "dispatch_failed" },
		});
	});

	test("explicit known provider rejection is distinguishable from possible acceptance", async () => {
		const service = new NotificationService();
		service.register({ id: "provider", deliver: () => { throw new NotificationChannelRejectedError(); } });
		await expect(service.deliver("provider", payload)).rejects.toMatchObject({
			outcome: "rejected", receipt: { destination: "provider", status: "rejected", code: "channel_rejected" },
		});
	});
});
