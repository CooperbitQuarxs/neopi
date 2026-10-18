import type { UsageReport } from "@oh-my-pi/pi-ai/usage";
import { type Component, matchesKey, routeSgrMouseInput, SelectList, type SelectItem, truncateToWidth } from "../index";
import { bottomBorder, dividerSplit, PanelRows, row, topBorderSplit } from "../chrome/overlay-box";
import { sanitizeStatusText } from "../chrome/shared";
import { SplitPane } from "../components/layout/split-pane";
import { Stack } from "../components/layout/stack";
import {
	STATUS_LINE_SEGMENT_IDS,
	isStatusLineSegmentId,
	parseUsageBarSegmentId,
	type BuiltinStatusLineSegmentId,
	type StatusLineSegmentId,
} from "../status-line/schema";
import { usageBarLabel } from "../status-line/segments";
import { getSelectListTheme, theme } from "../theme";
import { getComposerShapeOptions } from "./composer-shape-registry";

export interface StatusLineConfigDraft {
	composerShape: string;
	leftSegments: StatusLineSegmentId[];
	rightSegments: StatusLineSegmentId[];
}

/** Persistence and live preview belong to the host, never to the overlay. */
export interface StatusLineConfigCallbacks {
	load: () => StatusLineConfigDraft;
	save: (draft: StatusLineConfigDraft) => Promise<void>;
	/** Undefined restores the original live configuration without saving it. */
	preview: (draft: StatusLineConfigDraft | undefined) => void;
	close: () => void;
	requestRender: () => void;
	notify: (message: string) => void;
	usageReports?: readonly UsageReport[];
	renderPreview?: (shape: string, width: number) => readonly string[];
}

type Group = "leftSegments" | "rightSegments";
const COMPOSER_ROW = "composer";
const SEGMENT_DESCRIPTIONS: Record<BuiltinStatusLineSegmentId, string> = {
	pi: "NeoPi brand, or the running turn's activity indicator and elapsed time.",
	status: "Statuses supplied by extensions, ordered by their registered keys.",
	model: "Active model and its thinking level.",
	live: "Live voice microphone phase, mute state, and composer destination.",
	mode: "Active planning, loop, goal, and other conversation modes.",
	path: "Working directory, abbreviated according to the path segment options.",
	git: "Git branch and configured working-tree change indicators.",
	pr: "Pull request associated with the active repository.",
	subagents: "Active background agents.",
	token_in: "Recorded input-token usage.",
	token_out: "Recorded output-token usage.",
	token_total: "Total recorded token usage.",
	token_rate: "Current generation speed in tokens per second.",
	cost: "Recorded session cost and any active time-based pricing indicator.",
	context_pct: "Current context usage as a percentage of the model's window.",
	context_total: "Total context-window capacity.",
	context_bar:
		"Context-window gauge with compaction markers. Fills the remaining width in any composer; hidden below eight cells. Uses statusLine.contextLine.",
	time_spent: "Time the agent has actively worked in this session, excluding idle time.",
	time: "Current local time, using the configured clock format.",
	session: "Current session identifier.",
	hostname: "Name of the machine running this session.",
	cache_read: "Recorded prompt-cache read tokens.",
	cache_write: "Recorded prompt-cache write tokens.",
	cache_hit: "Prompt-cache hit rate.",
	session_name: "Current session title; the band composer places it on its working row.",
	usage: "Quota summary for the active provider and account.",
	collab: "Collaboration role and connected participants.",
	stream: "Streaming response activity.",
	vim: "Vim editing mode and pending keys.",
};
const KEY_HINTS = "↑/↓ select · Space toggle · [/] or Alt+↑/↓ reorder · Tab/←/→ group · s save · Esc cancel";

function copyDraft(draft: StatusLineConfigDraft): StatusLineConfigDraft {
	return { ...draft, leftSegments: [...draft.leftSegments], rightSegments: [...draft.rightSegments] };
}

function segmentLabel(id: StatusLineSegmentId): string {
	const bar = parseUsageBarSegmentId(id);
	if (bar) return usageBarLabel(bar);
	if (id === "pi") return "Brand";
	const words = id.replaceAll("_", " ");
	return words[0]!.toUpperCase() + words.slice(1);
}

export class StatusLineConfigOverlayComponent implements Component {
	readonly #cb: StatusLineConfigCallbacks;
	readonly #original: StatusLineConfigDraft;
	readonly #draft: StatusLineConfigDraft;
	readonly #ids: StatusLineSegmentId[];
	readonly #shapes = getComposerShapeOptions();
	readonly #list = new SelectList([], 20, getSelectListTheme(), { search: "never" });
	#saving = false;
	#closed = false;
	#bodyRows = 20;
	readonly #top = new PanelRows();
	readonly #divider = new PanelRows();
	readonly #footer = new PanelRows();
	readonly #bottom = new PanelRows();
	readonly #split = new SplitPane({
		left: (width, height) => {
			this.#list.setMaxVisible(height ?? this.#bodyRows);
			return this.#list.render(width);
		},
		right: (width, height) => this.#details(width).slice(0, height ?? this.#bodyRows),
		leftSize: { ratio: 0.5, min: 26, max: 72 },
		prefix: () => `${theme.fg("border", theme.boxRound.vertical)} `,
		divider: () => ` ${theme.fg("border", theme.boxRound.vertical)} `,
		suffix: () => ` ${theme.fg("border", theme.boxRound.vertical)}`,
	});
	readonly #frame = new Stack({
		children: [
			{ content: this.#top, height: 1 },
			{ content: this.#split, grow: 1 },
			{ content: this.#divider, height: 1 },
			{ content: this.#footer, height: 1 },
			{ content: this.#bottom, height: 1 },
		],
	});

	constructor(callbacks: StatusLineConfigCallbacks) {
		this.#cb = callbacks;
		this.#original = copyDraft(callbacks.load());
		this.#draft = copyDraft(this.#original);
		const ids = new Set<StatusLineSegmentId>([
			...STATUS_LINE_SEGMENT_IDS,
			...this.#draft.leftSegments,
			...this.#draft.rightSegments,
		]);
		for (const report of callbacks.usageReports ?? []) {
			for (const limit of report.limits) {
				const { windowId, tier } = limit.scope;
				if (!windowId) continue;
				const normalizedTier = tier?.trim().toLowerCase();
				const id = `usage:${report.provider}:${windowId}${normalizedTier ? `:${normalizedTier}` : ""}`;
				if (isStatusLineSegmentId(id)) ids.add(id);
			}
		}
		this.#ids = [...ids];
		this.#list.onSelectionChange = () => this.#cb.requestRender();
		this.#list.onSelect = () => this.#toggle();
		this.#list.onCancel = () => this.#cancel();
		this.#refresh(COMPOSER_ROW);
	}

	get #dirty(): boolean {
		return (
			this.#draft.composerShape !== this.#original.composerShape ||
			(["leftSegments", "rightSegments"] as const).some(
				group =>
					this.#draft[group].length !== this.#original[group].length ||
					this.#draft[group].some((id, index) => id !== this.#original[group][index]),
			)
		);
	}

	#group(id: StatusLineSegmentId): Group | undefined {
		return this.#draft.leftSegments.includes(id)
			? "leftSegments"
			: this.#draft.rightSegments.includes(id)
				? "rightSegments"
				: undefined;
	}

	#refresh(selected: string): void {
		const shape = this.#shapes.find(shape => shape.value === this.#draft.composerShape);
		const items: SelectItem[] = [
			{ value: COMPOSER_ROW, label: `Composer: ${shape?.label ?? this.#draft.composerShape}` },
		];
		const ids = new Set([...this.#draft.leftSegments, ...this.#draft.rightSegments, ...this.#ids]);
		for (const id of ids) {
			const group = this.#group(id);
			const groupLabel = group === "leftSegments" ? "left" : group ? "right" : "disabled";
			items.push({
				value: id,
				label: `[${group ? "x" : " "}] ${groupLabel} · ${sanitizeStatusText(id)} · ${segmentLabel(id)}`,
			});
		}
		this.#list.setItems(items);
		this.#list.setSelectedIndex(
			Math.max(
				0,
				items.findIndex(item => item.value === selected),
			),
		);
	}

	#changed(selected: string): void {
		this.#refresh(selected);
		this.#cb.preview(copyDraft(this.#draft));
		this.#cb.requestRender();
	}

	#toggle(): void {
		const id = this.#list.getSelectedItem()?.value;
		if (id === COMPOSER_ROW) {
			const index = this.#shapes.findIndex(shape => shape.value === this.#draft.composerShape);
			this.#draft.composerShape = this.#shapes[(index + 1) % this.#shapes.length]!.value;
			this.#changed(id);
		} else if (id && isStatusLineSegmentId(id)) {
			const group = this.#group(id);
			if (group) this.#draft[group].splice(this.#draft[group].indexOf(id), 1);
			else this.#draft.leftSegments.push(id);
			this.#changed(id);
		}
	}

	#move(direction: -1 | 1, switchGroup = false): void {
		const id = this.#list.getSelectedItem()?.value;
		if (!id || !isStatusLineSegmentId(id)) return;
		const group = this.#group(id);
		if (!group) return;
		const source = this.#draft[group];
		const index = source.indexOf(id);
		const next = index + direction;
		if (!switchGroup && next >= 0 && next < source.length) {
			source.splice(index, 1);
			source.splice(next, 0, id);
		} else if (
			switchGroup ||
			(group === "leftSegments" && direction === 1) ||
			(group === "rightSegments" && direction === -1)
		) {
			source.splice(index, 1);
			const target = this.#draft[group === "leftSegments" ? "rightSegments" : "leftSegments"];
			if (!switchGroup && direction === 1) target.unshift(id);
			else target.push(id);
		} else return;
		this.#changed(id);
	}

	async #save(): Promise<void> {
		this.#saving = true;
		this.#cb.requestRender();
		try {
			await this.#cb.save(copyDraft(this.#draft));
			this.#closed = true;
			this.#cb.notify("Saved status-line layout and composer.");
			this.#cb.close();
		} catch (error) {
			this.#cb.notify(`Could not save status-line layout: ${sanitizeStatusText(String(error))}`);
		} finally {
			this.#saving = false;
			this.#cb.requestRender();
		}
	}

	#cancel(): void {
		this.#closed = true;
		this.#cb.preview(undefined);
		if (this.#dirty) this.#cb.notify("Discarded unsaved status-line changes.");
		this.#cb.close();
	}

	handleInput(data: string): void {
		if (this.#closed || this.#saving) return;
		if (data.startsWith("\x1b[<")) {
			routeSgrMouseInput(data, event => {
				const hit = this.#frame.locate(event.row, event.col);
				const pane = hit?.index === 1 ? this.#split.locate(hit.line, hit.col) : undefined;
				if (pane?.pane !== "left") return false;
				this.#list.routeMouse(event, pane.line, pane.col);
				return true;
			});
		} else if (data === "s" || matchesKey(data, "ctrl+s")) void this.#save();
		else if (data === " ") this.#toggle();
		else if (data === "[" || matchesKey(data, "alt+up")) this.#move(-1);
		else if (data === "]" || matchesKey(data, "alt+down")) this.#move(1);
		else if (matchesKey(data, "tab") || matchesKey(data, "left") || matchesKey(data, "right")) this.#move(1, true);
		else this.#list.handleInput(data);
	}

	#details(width: number): string[] {
		const id = this.#list.getSelectedItem()?.value;
		const description =
			id === COMPOSER_ROW
				? (this.#shapes.find(shape => shape.value === this.#draft.composerShape)?.description ??
					"Enter or Space cycles the composer shape.")
				: id && parseUsageBarSegmentId(id)
					? "Provider quota window: percentage used and age of the latest cached report, independent of the selected model."
					: (SEGMENT_DESCRIPTIONS[id as BuiltinStatusLineSegmentId] ?? "Choose a status-line widget.");
		const lines = Bun.wrapAnsi(sanitizeStatusText(description), Math.max(1, width)).split("\n");
		lines.push(
			"",
			theme.fg("accent", "Live preview"),
			"",
			...(this.#cb.renderPreview?.(this.#draft.composerShape, width) ?? []),
			"",
			...Bun.wrapAnsi(KEY_HINTS, Math.max(1, width)).split("\n"),
		);
		return lines.map(line => truncateToWidth(line, width));
	}

	render(width: number): readonly string[] {
		this.#bodyRows = Math.max(3, (process.stdout.rows || 40) - 4);
		this.#split.setHeight(this.#bodyRows);
		const leftWidth = this.#split.measure(width).left?.width ?? 0;
		this.#top.setLines([
			topBorderSplit(width, `Status-line configuration${this.#dirty ? " · unsaved" : ""}`, leftWidth),
		]);
		this.#divider.setLines([dividerSplit(width, leftWidth)]);
		this.#footer.setLines([row(theme.fg("dim", this.#saving ? "Saving…" : KEY_HINTS), width)]);
		this.#bottom.setLines([bottomBorder(width)]);
		this.#frame.setHeight(this.#bodyRows + 4);
		return this.#frame.render(width);
	}
}
