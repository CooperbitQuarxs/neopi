/**
 * Fullscreen IRC communications viewer: the operator's history of every
 * agent-to-agent message in this session, which the transcript's live IRC
 * cards (capped, auto-retiring) cannot hold. Read-only; it never changes what
 * any agent can see.
 */
import { formatKeyHint, type KeyId } from "../app-keybindings";
import { bottomBorder, divider, row, topBorder } from "../chrome/overlay-box";
import { MenuKeyReader, MenuSearchField, type MenuSearchState } from "../components/menu-navigation";
import { matchesKey } from "../keys";
import { routeSgrMouseInput } from "../mouse";
import { theme } from "../theme/theme";
import type { IrcLogEntry, IrcLogSource } from "../tools/irc";
import type { Component } from "../tui";
import { Ellipsis, replaceTabs, truncateToWidth, wrapTextWithAnsi } from "../utils";
import { sanitizeDisplaySingleLine, sanitizeDisplayText } from "./extensions/display-text";

/** Body lines a collapsed entry shows before its "+N more" line. */
const COLLAPSED_BODY_LINES = 2;
/** Rows of chrome around the message list: top border, status row, two dividers, footer row, bottom border. */
const CHROME_ROWS = 6;

export interface IrcViewerOptions {
	readonly source: IrcLogSource;
	/** Keys that opened the viewer; pressing one again closes it. */
	readonly viewerKeys: readonly KeyId[];
	/** Keys that expand or collapse the selected message (Enter always does). */
	readonly expandKeys: readonly KeyId[];
	/** Screen rows the viewer fills. */
	readonly rows: () => number;
	readonly onClose: () => void;
	readonly requestRender: () => void;
	/** The operator's IRC id: replying to her own message answers its recipient. */
	readonly operatorId?: string;
	/** Sends as the operator; with it, `r` replies to the selected message. Resolves with the delivery summary. */
	readonly reply?: (to: string, message: string, replyTo: string) => Promise<{ text: string; isError: boolean }>;
}

/** `HH:MM:SS` in local time. */
function clockTime(ts: number): string {
	const date = new Date(ts);
	return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

function matchesParticipant(entry: IrcLogEntry, query: string): boolean {
	if (!query) return true;
	const needle = query.toLowerCase();
	return entry.message.from.toLowerCase().includes(needle) || entry.message.to.toLowerCase().includes(needle);
}

export interface IrcViewerPageNavigation {
	selected: string | undefined;
	selectedIndex: number;
	top: number;
	follow: boolean;
	expanded: string[];
	filter: MenuSearchState;
	draft: MenuSearchState;
	compose: { to: string; replyTo: string } | undefined;
}

export interface IrcViewerNavigation extends IrcViewerPageNavigation {
	parent: IrcViewerPageNavigation | undefined;
}

export class IrcViewerComponent implements Component {
	readonly #options: IrcViewerOptions;
	readonly #unsubscribe: () => void;
	readonly #filter = new MenuSearchField();
	readonly #keys = new MenuKeyReader();
	/** Index into the filtered entries; the last entry while following. */
	#selected = 0;
	/** Keep the newest message selected as traffic arrives. */
	#follow = true;
	/** First list row on screen. */
	#top = 0;
	/** List rows the last frame had room for. */
	#listRows = 1;
	#totalRows = 0;
	#visibleMessages = 1;
	#revealSelection = true;
	readonly #expanded = new Set<string>();
	/** The reply being written, and to whom. */
	#compose: { to: string; replyTo: string } | undefined;
	#replyParent: IrcViewerPageNavigation | undefined;
	readonly #draft = new MenuSearchField();
	#sending = false;
	onNavigationVisit?: (page: string, previousSnapshot: unknown) => void;
	/** Outcome of the last reply, shown in the status row until the next key. */
	#notice: { text: string; isError: boolean } | undefined;

	constructor(options: IrcViewerOptions) {
		this.#options = options;
		this.#unsubscribe = options.source.subscribe(() => options.requestRender());
	}

	dispose(): void {
		this.#unsubscribe();
	}

	invalidate(): void {}

	get blocksMenuHistory(): boolean {
		return this.#sending;
	}

	navigationSnapshot(): IrcViewerNavigation {
		return {
			selected: this.#visible()[this.#selected]?.message.id,
			selectedIndex: this.#selected,
			top: this.#top,
			follow: this.#follow,
			expanded: [...this.#expanded],
			filter: this.#filter.navigationSnapshot(),
			draft: this.#draft.navigationSnapshot(),
			compose: this.#compose ? { ...this.#compose } : undefined,
			parent: this.#replyParent ? structuredClone(this.#replyParent) : undefined,
		};
	}

	restoreNavigation(snapshot: unknown): void {
		if (typeof snapshot !== "object" || snapshot === null) return;
		const state = snapshot as Partial<IrcViewerNavigation>;
		this.#filter.restoreNavigation(state.filter);
		this.#draft.restoreNavigation(state.draft);
		const entries = this.#visible();
		const selected = entries.findIndex(entry => entry.message.id === state.selected);
		this.#selected = selected >= 0 ? selected : Math.max(0, Math.min(entries.length - 1, state.selectedIndex ?? 0));
		this.#top = typeof state.top === "number" ? Math.max(0, state.top) : 0;
		this.#follow = state.follow === true;
		this.#expanded.clear();
		for (const id of state.expanded ?? []) this.#expanded.add(id);
		this.#compose = state.compose && this.#options.reply ? { ...state.compose } : undefined;
		this.#replyParent = this.#compose && state.parent ? structuredClone(state.parent) : undefined;
		if (!this.#compose) this.#draft.focused = false;
		this.#revealSelection = false;
		this.#keys.reset();
		this.#options.requestRender();
	}

	#visible(): readonly IrcLogEntry[] {
		const query = this.#filter.value.trim();
		const entries = this.#options.source.entries();
		return query ? entries.filter(entry => matchesParticipant(entry, query)) : entries;
	}

	#header(entry: IrcLogEntry, selected: boolean): string {
		const { message } = entry;
		const from = sanitizeDisplaySingleLine(message.from);
		const to = sanitizeDisplaySingleLine(message.to);
		const names = `${from} ${theme.fg("accent", theme.nav.selected)} ${to}`;
		const meta: string[] = [];
		if (entry.broadcast) meta.push("broadcast");
		if (message.replyTo) meta.push("reply");
		if (message.wakeRelay) meta.push("relay");
		if (entry.outcome === "queued") meta.push("queued");
		const failed =
			entry.outcome === "failed"
				? `  ${theme.fg("error", `failed${entry.error ? `: ${sanitizeDisplaySingleLine(entry.error)}` : ""}`)}`
				: "";
		const gutter = selected ? theme.fg("accent", "▍") : " ";
		return `${gutter}${theme.fg("dim", clockTime(message.ts))}  ${selected ? theme.bold(names) : names}${
			meta.length > 0 ? theme.fg("dim", `  ${meta.join(" · ")}`) : ""
		}${failed}`;
	}

	#bodyLines(entry: IrcLogEntry, width: number, selected: boolean): string[] {
		const gutter = selected ? theme.fg("accent", "▍") : " ";
		const quote = theme.fg("dim", theme.md.quoteBorder);
		const lineWidth = Math.max(1, width - 4);
		const wrapped = replaceTabs(sanitizeDisplayText(entry.message.body))
			.split("\n")
			.flatMap(line => (line.trim() ? wrapTextWithAnsi(line, lineWidth) : [""]));
		while (wrapped.length > 0 && !wrapped[wrapped.length - 1]?.trim()) wrapped.pop();
		const expanded = this.#expanded.has(entry.message.id);
		const shown = expanded ? wrapped : wrapped.slice(0, COLLAPSED_BODY_LINES);
		const lines = shown.map(line => `${gutter} ${quote} ${theme.fg("toolOutput", line)}`);
		const hidden = wrapped.length - shown.length;
		if (hidden > 0) {
			lines.push(`${gutter} ${quote} ${theme.fg("dim", `… +${hidden} more ${hidden === 1 ? "line" : "lines"}`)}`);
		}
		return lines;
	}

	render(width: number): readonly string[] {
		const height = Math.max(CHROME_ROWS + 1, this.#options.rows());
		const inner = Math.max(1, width - 4);
		const all = this.#options.source.entries();
		const visible = this.#visible();
		if (this.#follow || this.#selected >= visible.length) this.#selected = Math.max(0, visible.length - 1);

		const list: string[] = [];
		let selectedStart = 0;
		let selectedEnd = 0;
		const starts: number[] = [];
		visible.forEach((entry, index) => {
			const selected = index === this.#selected;
			starts.push(list.length);
			if (selected) selectedStart = list.length;
			list.push(this.#header(entry, selected), ...this.#bodyLines(entry, inner, selected));
			if (selected) selectedEnd = list.length;
		});

		this.#listRows = height - CHROME_ROWS;
		this.#totalRows = list.length;
		if (this.#follow) this.#top = Math.max(0, list.length - this.#listRows);
		else if (this.#revealSelection) {
			if (selectedStart < this.#top) this.#top = selectedStart;
			else if (selectedEnd > this.#top + this.#listRows)
				this.#top = Math.min(selectedStart, selectedEnd - this.#listRows);
		}
		this.#revealSelection = false;
		this.#top = Math.max(0, Math.min(this.#top, Math.max(0, list.length - this.#listRows)));
		this.#visibleMessages = 0;
		for (let index = 0; index < starts.length; index++) {
			if (starts[index]! < this.#top + this.#listRows && (starts[index + 1] ?? list.length) > this.#top)
				this.#visibleMessages++;
		}
		this.#visibleMessages = Math.max(1, this.#visibleMessages);

		const body =
			visible.length === 0
				? [
						theme.fg(
							"dim",
							all.length === 0 ? "No agent messages in this session yet." : "No messages match the filter.",
						),
					]
				: list.slice(this.#top, this.#top + this.#listRows);
		while (body.length < this.#listRows) body.push("");

		const participants = new Set(all.flatMap(entry => [entry.message.from, entry.message.to])).size;
		const broadcasts = all.filter(entry => entry.broadcast).length;
		const counts = `${all.length} ${all.length === 1 ? "message" : "messages"} · ${broadcasts} broadcast · ${participants} ${participants === 1 ? "participant" : "participants"}`;
		const query = this.#filter.value;
		const draft = this.#compose
			? this.#draft.input.render(Math.max(0, inner - 12 - this.#compose.to.length))[0] ?? ""
			: "";
		const filter = this.#filter.focused
			? this.#filter.input.render(Math.max(0, inner - 8))[0] ?? ""
			: query;
		const status = this.#filter.focused
			? theme.fg("accent", `filter: ${filter}`)
			: this.#compose
				? theme.fg("accent", `reply to ${sanitizeDisplaySingleLine(this.#compose.to)}: ${draft}`)
				: this.#notice
					? theme.fg(this.#notice.isError ? "error" : "success", sanitizeDisplaySingleLine(this.#notice.text))
					: query
						? `${theme.fg("accent", `filter: ${filter}`)}${theme.fg("dim", `  ${visible.length} shown · ${counts}`)}`
						: theme.fg("dim", counts);

		const hints = this.#filter.focused
			? "enter apply · esc leave field"
			: this.#compose
				? this.#draft.focused
					? "enter send · Tab view · esc leave field"
					: "j/k select · Tab edit reply · esc back"
				: `j/k select · enter/space expand${this.#options.reply ? " · r reply" : ""} · / filter · G follow · ${[
						"esc",
						...this.#options.viewerKeys.map(key => formatKeyHint(key)),
					].join("/")} close`;

		const frame = [
			topBorder(width, "IRC"),
			row(status, width),
			divider(width),
			...body.map(line => row(truncateToWidth(line, inner, Ellipsis.Unicode), width)),
			divider(width),
			row(theme.fg("muted", truncateToWidth(hints, inner, Ellipsis.Unicode)), width),
			bottomBorder(width),
		];
		return frame;
	}

	#select(index: number): void {
		const count = this.#visible().length;
		if (count === 0) return;
		this.#selected = Math.max(0, Math.min(count - 1, index));
		this.#follow = this.#selected === count - 1;
		this.#revealSelection = true;
		this.#options.requestRender();
	}

	#toggleExpanded(): void {
		const entry = this.#visible()[this.#selected];
		if (!entry) return;
		const { id } = entry.message;
		if (!this.#expanded.delete(id)) this.#expanded.add(id);
		this.#follow = false;
		this.#revealSelection = true;
		this.#options.requestRender();
	}

	#handleFilterInput(data: string): boolean {
		const result = this.#filter.handleInput(data);
		if (result === "pass") {
			if (!matchesKey(data, "enter") && data !== "\n") return false;
			this.#filter.focused = false;
		} else if (result === "edited") {
			this.#follow = true;
			this.#revealSelection = true;
		}
		this.#keys.reset();
		this.#options.requestRender();
		return true;
	}

	#startReply(): void {
		const entry = this.#visible()[this.#selected];
		if (!entry || !this.#options.reply) return;
		const previous = this.navigationSnapshot();
		this.#replyParent = previous;
		const { message } = entry;
		const to = message.from === this.#options.operatorId ? message.to : message.from;
		this.#compose = { to, replyTo: message.id };
		this.#filter.focused = false;
		this.#draft.setValue("");
		this.#draft.focused = true;
		this.#keys.reset();
		this.#options.requestRender();
		this.onNavigationVisit?.("reply", previous);
	}

	#leaveReply(): void {
		const previous = this.navigationSnapshot();
		const parent = this.#replyParent;
		if (parent) this.restoreNavigation(parent);
		else {
			this.#compose = undefined;
			this.#replyParent = undefined;
			this.#draft.focused = false;
			this.#keys.reset();
			this.#options.requestRender();
		}
		this.onNavigationVisit?.("", previous);
	}

	#handleComposeInput(data: string): boolean {
		const compose = this.#compose;
		const reply = this.#options.reply;
		if (!compose || !reply || !this.#draft.focused) return false;
		const result = this.#draft.handleInput(data);
		if (result !== "pass") {
			this.#keys.reset();
			this.#options.requestRender();
			return true;
		}
		if (!matchesKey(data, "enter") && data !== "\n") return false;
		const body = this.#draft.value.trim();
		if (!body) return true;
		this.#leaveReply();
		this.#sending = true;
		this.#follow = true;
		void reply(compose.to, body, compose.replyTo).then(
			result => {
				this.#notice = result;
			},
			(error: unknown) => {
				this.#notice = { text: error instanceof Error ? error.message : String(error), isError: true };
			},
		).finally(() => {
			this.#sending = false;
			this.#options.requestRender();
		});
		return true;
	}

	#scrollBy(delta: number): void {
		this.#follow = false;
		this.#revealSelection = false;
		this.#top = Math.max(0, Math.min(Math.max(0, this.#totalRows - this.#listRows), this.#top + delta));
		this.#options.requestRender();
	}

	handleInput(data: string): void {
		if (
			routeSgrMouseInput(data, event => {
				if (event.wheel === null) return false;
				this.#select(this.#selected + event.wheel);
				return true;
			})
		) {
			return;
		}
		if (this.#handleComposeInput(data)) return;
		this.#notice = undefined;
		if (this.#filter.focused && this.#handleFilterInput(data)) return;
		const action = this.#keys.read(data);
		if (action === "pending") return;
		if (action?.kind === "cancel") {
			if (this.#compose) this.#leaveReply();
			else this.#options.onClose();
		} else if (this.#options.viewerKeys.some(key => matchesKey(data, key))) {
			this.#options.onClose();
		} else if (action?.kind === "context") {
			if (this.#compose) this.#draft.focused = !this.#draft.focused;
			this.#filter.focused = false;
			this.#keys.reset();
			this.#options.requestRender();
		} else if (action?.kind === "search") {
			this.#filter.focused = true;
			this.#draft.focused = false;
			this.#keys.reset();
			this.#options.requestRender();
		} else if (data === "r" && this.#options.reply && !this.#compose && !this.#sending) {
			this.#startReply();
		} else if (action?.kind === "confirm" || action?.kind === "toggle" ||
			this.#options.expandKeys.some(key => matchesKey(data, key))) {
			this.#toggleExpanded();
		} else if (action?.kind === "move") this.#select(this.#selected + action.delta);
		else if (action?.kind === "halfPage")
			this.#select(this.#selected + action.delta * Math.max(1, Math.floor(this.#visibleMessages / 2)));
		else if (action?.kind === "page") this.#select(this.#selected + action.delta * this.#visibleMessages);
		else if (action?.kind === "scroll") this.#scrollBy(action.delta);
		else if (action?.kind === "boundary") this.#select(action.edge === "first" ? 0 : Number.MAX_SAFE_INTEGER);
	}
}
