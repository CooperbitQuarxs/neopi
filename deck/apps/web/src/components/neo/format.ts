/**
 * Number and time formatting shared by the Neo pages, matching what `/stats`
 * prints: compact integers (`1.4K`), tabular elapsed times (`1m 05s`) and
 * relative timestamps (`3 days ago`). Card-specific formatters (brief card
 * times, cron phrases) stay next to their components.
 */

const LOCALE = "en-US";

export function formatInteger(value: number): string {
	return value.toLocaleString(LOCALE);
}

export function formatCompact(value: number): string {
	return value.toLocaleString(LOCALE, { notation: "compact" });
}

export function formatPercent(value: number, digits = 1): string {
	return `${(value * 100).toFixed(digits)}%`;
}

/** `0.8s`, `412ms`, `–` for nothing. */
export function formatDurationMs(value: number | null | undefined, digits = 1): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return "–";
	if (value < 1000) return `${Math.round(value)}ms`;
	return `${(value / 1000).toFixed(digits)}s`;
}

/** `42.0s`, `1m 05s`, `3h 12m`. */
export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "–";
	if (ms < 60_000) return formatDurationMs(ms);
	const totalMin = Math.floor(ms / 60_000);
	if (totalMin < 60) return `${totalMin}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
	const hours = Math.floor(totalMin / 60);
	if (hours < 48) return `${hours}h ${String(totalMin % 60).padStart(2, "0")}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** `just now`, `4 minutes ago`, `3 days ago`, `in 2 hours`. */
export function formatRelativeTime(when: string | number | Date, now: number = Date.now()): string {
	const t = when instanceof Date ? when.getTime() : typeof when === "number" ? when : Date.parse(when);
	if (!Number.isFinite(t)) return "–";
	const diff = t - now;
	const abs = Math.abs(diff);
	const future = diff > 0;
	const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
	if (abs < 45_000) return future ? "in a moment" : "just now";
	const minutes = Math.round(abs / 60_000);
	if (minutes < 60) return wrap(`${minutes} minute${minutes === 1 ? "" : "s"}`);
	const hours = Math.round(abs / 3_600_000);
	if (hours < 24) return wrap(`${hours} hour${hours === 1 ? "" : "s"}`);
	const days = Math.round(abs / 86_400_000);
	if (days < 30) return wrap(`${days} day${days === 1 ? "" : "s"}`);
	const months = Math.round(days / 30);
	if (months < 12) return wrap(`${months} month${months === 1 ? "" : "s"}`);
	const years = Math.round(days / 365);
	return wrap(`${years} year${years === 1 ? "" : "s"}`);
}

/** Short relative time for dense cells: `now`, `4m`, `3h`, `6d`. */
export function formatShortRelative(when: string | number, now: number = Date.now()): string {
	const t = typeof when === "number" ? when : Date.parse(when);
	if (!Number.isFinite(t)) return "–";
	const m = Math.round(Math.abs(now - t) / 60_000);
	if (m < 1) return "now";
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

export function formatTimestamp(when: string | number | Date): string {
	const d = when instanceof Date ? when : new Date(when);
	if (Number.isNaN(d.getTime())) return "–";
	return d.toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** `/home/me/source/github/org/repo` → `org/repo`. */
export function formatFolder(folder: string, parts = 2): string {
	const bits = folder.split(/[\\/]/).filter(Boolean);
	return bits.slice(-parts).join("/") || folder;
}

/** Cost in USD from millionths. */
export function formatMicros(micros: number | undefined | null): string {
	if (micros === undefined || micros === null || !Number.isFinite(micros)) return "–";
	const usd = micros / 1_000_000;
	if (usd === 0) return "$0";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}
