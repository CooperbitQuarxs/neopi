import { describe, expect, test } from "bun:test";

import { cronInWords, describeTrigger } from "./trigger-summary";

describe("cronInWords", () => {
	test("reads the common shapes as words", () => {
		expect(cronInWords("* * * * *")).toBe("Every minute");
		expect(cronInWords("*/15 * * * *")).toBe("Every 15 minutes");
		expect(cronInWords("0 * * * *")).toBe("Every hour");
		expect(cronInWords("30 * * * *")).toBe("Every hour at :30");
		expect(cronInWords("0 */6 * * *")).toBe("Every 6 hours");
		expect(cronInWords("0 7 * * *")).toBe("Every day at 07:00");
		expect(cronInWords("5 9 * * 1-5")).toBe("Weekdays at 09:05");
		expect(cronInWords("0 9 * * 0")).toBe("Every Sunday at 09:00");
		expect(cronInWords("0 9 * * 1,3")).toBe("Mon, Wed at 09:00");
	});

	test("leaves unusual shapes to the raw expression", () => {
		expect(cronInWords("0 9 1 * *")).toBeUndefined();
		expect(cronInWords("0 9 * 6 *")).toBeUndefined();
		expect(cronInWords("bogus")).toBeUndefined();
	});
});

describe("describeTrigger", () => {
	test("falls back to the expression in mono when it has no words", () => {
		expect(describeTrigger({ cron: "0 9 1 * *" })).toEqual({ kind: "cron", text: "0 9 1 * *", mono: true });
	});

	test("describes webhooks by path and manual triggers in words", () => {
		expect(describeTrigger({ webhook: { path: "/hooks/abc", secret_env: "S" } })).toEqual({ kind: "webhook", text: "/hooks/abc", mono: true });
		expect(describeTrigger({ manual: {} })).toEqual({ kind: "manual", text: "Run by hand", mono: false });
	});
});
