import type { RoutineTrigger } from "@npi-deck/protocol";

export type TriggerKind = "cron" | "webhook" | "manual" | "event";

export function triggerKind(trigger: RoutineTrigger): TriggerKind {
	if ("cron" in trigger) return "cron";
	if ("webhook" in trigger) return "webhook";
	if ("manual" in trigger) return "manual";
	return "event";
}

export interface TriggerSummary {
	kind: TriggerKind;
	/** One line, in words where the expression is a common one. */
	text: string;
	/** True when `text` is the raw expression/path and should be set in mono. */
	mono: boolean;
}

/** What starts the routine, in words: "Weekdays at 07:00", "Webhook /hooks/x", "Run by hand". */
export function describeTrigger(trigger: RoutineTrigger): TriggerSummary {
	const kind = triggerKind(trigger);
	switch (kind) {
		case "cron": {
			const expr = (trigger as { cron: string }).cron.trim();
			const words = cronInWords(expr);
			return words ? { kind, text: words, mono: false } : { kind, text: expr || "No schedule yet", mono: expr.length > 0 };
		}
		case "webhook":
			return { kind, text: (trigger as { webhook: { path: string } }).webhook.path || "Webhook", mono: true };
		case "manual":
			return { kind, text: "Run by hand", mono: false };
		default:
			return { kind, text: "On an event", mono: false };
	}
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Common five-field cron shapes, in words. `undefined` when the shape is unusual. */
export function cronInWords(expr: string): string | undefined {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return undefined;
	const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
	if (dom !== "*" || mon !== "*") return undefined;
	if (min === "*" && hour === "*" && dow === "*") return "Every minute";
	const everyMin = /^\*\/(\d+)$/.exec(min);
	if (everyMin && hour === "*" && dow === "*") return `Every ${everyMin[1]} minutes`;
	if (/^\d+$/.test(min) && hour === "*" && dow === "*") return min === "0" ? "Every hour" : `Every hour at :${min.padStart(2, "0")}`;
	const everyHour = /^\*\/(\d+)$/.exec(hour);
	if (/^\d+$/.test(min) && everyHour && dow === "*") return `Every ${everyHour[1]} hours`;
	if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return undefined;
	const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
	if (dow === "*") return `Every day at ${time}`;
	if (dow === "1-5") return `Weekdays at ${time}`;
	if (dow === "0,6" || dow === "6,0") return `Weekends at ${time}`;
	if (/^\d$/.test(dow)) {
		const name = DAY_NAMES[Number(dow) % 7];
		return name ? `Every ${name} at ${time}` : undefined;
	}
	if (/^\d(,\d)+$/.test(dow)) {
		const names = dow.split(",").map((d) => DAY_SHORT[Number(d) % 7]).filter(Boolean);
		return `${names.join(", ")} at ${time}`;
	}
	return undefined;
}
