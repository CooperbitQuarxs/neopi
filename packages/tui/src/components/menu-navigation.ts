import { getKeybindings } from "../keybindings";
import { extractPrintableText, matchesKey } from "../keys";
import { getMenuWindow, type MenuWindow } from "./menu-selection";
import { Input } from "./input";
import { replaceTabs, truncateToWidth, visibleWidth } from "../utils";

/**
 * A normal-navigation intent resolved from one key. Hosts apply motions with
 * {@link applyMenuMotion} and decide what the remaining intents mean on their
 * surface (AGENTS.md › Menu Navigation).
 */
export type MenuNavAction =
	/** `j`/`k`, Down/Up. */
	| { kind: "move"; delta: -1 | 1 }
	/** `h`/`l`, Left/Right: pane switch, collapse/expand, reorder, or value adjust, per surface. */
	| { kind: "horizontal"; delta: -1 | 1 }
	/** `Ctrl-d`/`Ctrl-u`. */
	| { kind: "halfPage"; delta: -1 | 1 }
	/** PageDown/PageUp. */
	| { kind: "page"; delta: -1 | 1 }
	/** `gg`/`G`, Home/End. */
	| { kind: "boundary"; edge: "first" | "last" }
	/** `Ctrl-e`/`Ctrl-y`: the view moves one line, the selection does not. */
	| { kind: "scroll"; delta: -1 | 1 }
	/** Space: checkbox toggle or soft activation. */
	| { kind: "toggle" }
	/** Enter. */
	| { kind: "confirm" }
	/** Esc / Ctrl-c. */
	| { kind: "cancel" }
	/** Tab/Shift-Tab: next/previous tab, section, or focus region. */
	| { kind: "context"; delta: -1 | 1 }
	/** `/`: focus the surface's filter or search field. */
	| { kind: "search" };

/**
 * Resolves raw input into {@link MenuNavAction}s for a surface in normal
 * navigation. Owns the `g` prefix of `gg`: a lone `g` reports `"pending"`, and
 * any key other than a second `g` cancels the prefix and resolves on its own.
 *
 * Hosts MUST route keys to a focused text field (filter, rename, form input)
 * before calling {@link read}, so printable keys type literally there.
 */
export class MenuKeyReader {
	#pendingG = false;

	/** True while a `g` waits for its second key. */
	get pending(): boolean {
		return this.#pendingG;
	}

	/** Drop a pending prefix, e.g. when focus moves into a text field. */
	reset(): void {
		this.#pendingG = false;
	}

	read(data: string): MenuNavAction | "pending" | undefined {
		const prefixed = this.#pendingG;
		this.#pendingG = false;
		if (matchesKey(data, "g")) {
			if (prefixed) return { kind: "boundary", edge: "first" };
			this.#pendingG = true;
			return "pending";
		}
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) return { kind: "cancel" };
		if (kb.matches(data, "tui.select.confirm") || data === "\n") return { kind: "confirm" };
		if (matchesKey(data, "shift+g") || kb.matches(data, "tui.select.last")) return { kind: "boundary", edge: "last" };
		if (kb.matches(data, "tui.select.first")) return { kind: "boundary", edge: "first" };
		if (kb.matches(data, "tui.select.up") || matchesKey(data, "k") || matchesKey(data, "shift+k"))
			return { kind: "move", delta: -1 };
		if (kb.matches(data, "tui.select.down") || matchesKey(data, "j") || matchesKey(data, "shift+j"))
			return { kind: "move", delta: 1 };
		if (kb.matches(data, "tui.select.left") || matchesKey(data, "h") || matchesKey(data, "shift+h"))
			return { kind: "horizontal", delta: -1 };
		if (kb.matches(data, "tui.select.right") || matchesKey(data, "l") || matchesKey(data, "shift+l"))
			return { kind: "horizontal", delta: 1 };
		if (kb.matches(data, "tui.select.halfPageUp")) return { kind: "halfPage", delta: -1 };
		if (kb.matches(data, "tui.select.halfPageDown")) return { kind: "halfPage", delta: 1 };
		if (kb.matches(data, "tui.select.pageUp")) return { kind: "page", delta: -1 };
		if (kb.matches(data, "tui.select.pageDown")) return { kind: "page", delta: 1 };
		if (kb.matches(data, "tui.select.scrollUp")) return { kind: "scroll", delta: -1 };
		if (kb.matches(data, "tui.select.scrollDown")) return { kind: "scroll", delta: 1 };
		if (kb.matches(data, "tui.select.toggle")) return { kind: "toggle" };
		if (kb.matches(data, "tui.select.prevContext")) return { kind: "context", delta: -1 };
		if (kb.matches(data, "tui.select.nextContext")) return { kind: "context", delta: 1 };
		if (kb.matches(data, "tui.select.search")) return { kind: "search" };
		return undefined;
	}
}

export interface MenuSearchState {
	value: string;
	focused: boolean;
	cursor: number;
}

export interface MenuSearchTheme {
	muted(text: string): string;
}

/**
 * A menu's literal search field. Hosts route focused input here before menu
 * shortcuts, refilter on "edited", and delegate "pass" to list navigation.
 * "edited" also covers caret-only editing so hosts repaint the field.
 */
export class MenuSearchField {
	readonly #input = new Input();

	constructor(value = "", focused = false) {
		this.#input.prompt = "";
		this.#input.setValue(value);
		this.#input.focused = focused;
	}

	/** Native picker bindings reuse the existing Input query/cursor transport. */
	get input(): Input {
		return this.#input;
	}

	get focused(): boolean {
		return this.#input.focused;
	}

	set focused(value: boolean) {
		this.#input.focused = value;
	}

	get value(): string {
		return this.#input.getValue();
	}

	get cursor(): number {
		return this.#input.getCursor();
	}

	setValue(value: string): void {
		this.#input.setValue(value);
	}

	handleInput(data: string): "edited" | "exited" | "pass" {
		if (!this.focused) return "pass";
		if (extractPrintableText(data) !== undefined) {
			this.#input.handleInput(data);
			return "edited";
		}
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			this.focused = false;
			return "exited";
		}
		if (
			kb.matches(data, "tui.select.up") ||
			kb.matches(data, "tui.select.down") ||
			kb.matches(data, "tui.select.pageUp") ||
			kb.matches(data, "tui.select.pageDown") ||
			kb.matches(data, "tui.select.confirm") ||
			data === "\n"
		) return "pass";
		return this.#input.handleInput(data) ? "edited" : "pass";
	}

	render(width: number, theme: MenuSearchTheme): string {
		const columns = Math.max(0, Math.trunc(width));
		const prefix = "Search: ";
		const hint = this.focused ? " · Esc back to list" : " · / search";
		const fieldWidth = Math.max(0, columns - visibleWidth(prefix) - visibleWidth(hint));
		const value = this.focused
			? (this.#input.render(fieldWidth)[0] ?? "")
			: truncateToWidth(replaceTabs(this.value), fieldWidth);
		return theme.muted(truncateToWidth(`${prefix}${replaceTabs(value)}${hint}`, columns));
	}

	navigationSnapshot(): MenuSearchState {
		return { value: this.value, focused: this.focused, cursor: this.cursor };
	}

	restoreNavigation(snapshot: unknown): void {
		if (typeof snapshot !== "object" || snapshot === null) return;
		const state = snapshot as Partial<MenuSearchState>;
		if (typeof state.value !== "string") return;
		this.setValue(state.value);
		if (typeof state.cursor === "number") this.#input.setCursor(state.cursor);
		this.focused = state.focused === true;
	}
}

/**
 * Scroll position over a list of variable-height items, independent of the
 * selection. Motions call {@link reveal} so the next layout scrolls the
 * minimum needed to show the selection; {@link scroll} moves only the view,
 * so the selection may leave the window until the next motion.
 */
export class MenuViewport {
	/** First visible item; undefined until the first layout, which centers the selection. */
	#top: number | undefined;
	#revealPending = false;
	/** Items shown by the last layout; sizes half-page and page motions. */
	#lastVisibleItems = 1;

	get top(): number | undefined {
		return this.#top;
	}

	/** Items the last layout showed (at least 1). */
	get visibleItems(): number {
		return this.#lastVisibleItems;
	}

	/** Ask the next layout to bring the selection into view. */
	reveal(): void {
		this.#revealPending = true;
	}

	/** Move the view by `delta` items; the next layout clamps it to the list. */
	scroll(delta: number): void {
		if (this.#top === undefined) return;
		this.#top = Math.max(0, this.#top + Math.trunc(delta));
	}

	/** Restore a saved top (menu history, drafts); clamped at the next layout. */
	setTop(top: number | undefined): void {
		this.#top = top === undefined ? undefined : Math.max(0, Math.trunc(top));
		this.#revealPending = false;
	}

	/**
	 * Compute the window for this frame. `rowCounts[i]` is item i's height in
	 * rows; `rowBudget` is the rows available.
	 */
	layout(rowCounts: readonly number[], selectedIndex: number, rowBudget: number): MenuWindow {
		const count = rowCounts.length;
		const budget = Math.max(1, Math.trunc(rowBudget));
		if (this.#top === undefined) {
			const centered = getMenuWindow(rowCounts, selectedIndex, budget);
			this.#top = centered.startIndex;
			this.#revealPending = false;
			this.#lastVisibleItems = Math.max(1, centered.endIndex - centered.startIndex);
			return centered;
		}
		let totalRows = 0;
		for (const rows of rowCounts) totalRows += Math.max(0, rows);
		if (count === 0) {
			this.#top = 0;
			this.#revealPending = false;
			return { startIndex: 0, endIndex: 0, rowOffset: 0, totalRows };
		}

		let top = Math.min(this.#top, count - 1);
		if (this.#revealPending && selectedIndex >= 0 && selectedIndex < count) {
			if (selectedIndex < top) top = selectedIndex;
			else while (top < selectedIndex && rowsBetween(rowCounts, top, selectedIndex + 1) > budget) top++;
		}
		this.#revealPending = false;
		top = Math.min(top, maxTop(rowCounts, budget));

		let endIndex = top + 1;
		let used = Math.max(0, rowCounts[top] ?? 0);
		while (endIndex < count) {
			const rows = Math.max(0, rowCounts[endIndex] ?? 0);
			if (used + rows > budget) break;
			used += rows;
			endIndex++;
		}
		this.#top = top;
		this.#lastVisibleItems = Math.max(1, endIndex - top);
		return { startIndex: top, endIndex, rowOffset: rowsBetween(rowCounts, 0, top), totalRows };
	}
}

function rowsBetween(rowCounts: readonly number[], start: number, end: number): number {
	let rows = 0;
	for (let index = start; index < end; index++) rows += Math.max(0, rowCounts[index] ?? 0);
	return rows;
}

/** The last top whose window still fills the budget, so the view never scrolls past the end. */
function maxTop(rowCounts: readonly number[], budget: number): number {
	let top = rowCounts.length - 1;
	let used = Math.max(0, rowCounts[top] ?? 0);
	while (top > 0) {
		const rows = Math.max(0, rowCounts[top - 1] ?? 0);
		if (used + rows > budget) break;
		used += rows;
		top--;
	}
	return Math.max(0, top);
}

/** The selection surface a motion drives; {@link MenuSelection} satisfies it. */
export interface MenuMotionTarget {
	move(delta: number, wrap?: boolean): boolean;
	moveToBoundary(edge: "first" | "last"): boolean;
}

/** Outcome of {@link applyMenuMotion}. */
export interface MenuMotionResult {
	/** The action was a motion; the host has nothing left to do for it. */
	handled: boolean;
	/** The selection moved; the host notifies its selection listeners. */
	selectionChanged: boolean;
}

const NOT_A_MOTION: MenuMotionResult = { handled: false, selectionChanged: false };

/**
 * Apply the vertical motions shared by every list: row, half page, page,
 * first/last, and view-only scroll. Half page and page move the view and the
 * selection by the same number of items, as Vim does. Returns unhandled for
 * horizontal, toggle, confirm, cancel, context, and search intents.
 */
export function applyMenuMotion(
	action: MenuNavAction,
	target: MenuMotionTarget,
	viewport: MenuViewport,
	options: { wrap?: boolean } = {},
): MenuMotionResult {
	let selectionChanged: boolean;
	switch (action.kind) {
		case "move":
			selectionChanged = target.move(action.delta, options.wrap ?? false);
			break;
		case "halfPage": {
			const step = Math.max(1, Math.floor(viewport.visibleItems / 2));
			viewport.scroll(action.delta * step);
			selectionChanged = target.move(action.delta * step);
			break;
		}
		case "page": {
			const step = viewport.visibleItems;
			viewport.scroll(action.delta * step);
			selectionChanged = target.move(action.delta * step);
			break;
		}
		case "boundary":
			selectionChanged = target.moveToBoundary(action.edge);
			break;
		case "scroll":
			viewport.scroll(action.delta);
			return { handled: true, selectionChanged: false };
		default:
			return NOT_A_MOTION;
	}
	viewport.reveal();
	return { handled: true, selectionChanged };
}

/**
 * A menu whose per-view context (tab, focused pane, selection, filter,
 * scroll, unsaved edits) survives a menu-history round trip. The host takes
 * a snapshot when the menu closes and hands it back right after reopening.
 * Nested navigation captures the previous snapshot, builds the new page,
 * then notifies the host. The empty page id names the root. Restoration
 * must not notify the host or create another visit.
 */
export interface MenuHistoryParticipant {
	navigationSnapshot(): unknown;
	restoreNavigation(snapshot: unknown): void;
	onNavigationVisit?: (page: string, previousSnapshot: unknown) => void;
	/** True only during an in-flight operation or credential prompt, not a pending second-press confirmation. */
	readonly blocksMenuHistory?: boolean;
}

export function isMenuHistoryParticipant(value: unknown): value is MenuHistoryParticipant {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Partial<MenuHistoryParticipant>).navigationSnapshot === "function" &&
		typeof (value as Partial<MenuHistoryParticipant>).restoreNavigation === "function"
	);
}

/**
 * A menu with live side effects (previews on the real UI, open streams) to
 * settle when menu history moves away from it. The host calls `leaveMenu`
 * just before hiding the menu: persist drafts, undo previews, never prompt.
 */
export interface MenuHistoryLeaver {
	leaveMenu(): void;
}

export function isMenuHistoryLeaver(value: unknown): value is MenuHistoryLeaver {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Partial<MenuHistoryLeaver>).leaveMenu === "function"
	);
}
