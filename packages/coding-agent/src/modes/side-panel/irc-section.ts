import type { MouseRoutable, SgrMouseEvent } from "@oh-my-pi/pi-tui";
import type { SidePanelSection } from "@oh-my-pi/pi-tui/chrome";
import { sanitizeDisplaySingleLine } from "@oh-my-pi/pi-tui/overlays/extensions/display-text";
import { clockTime } from "@oh-my-pi/pi-tui/overlays/irc-viewer";
import { truncateToWidth } from "@oh-my-pi/pi-tui/render/render-utils";
import { theme } from "@oh-my-pi/pi-tui/theme";
import type { IrcLogEntry, IrcLogSource } from "@oh-my-pi/pi-tui/tools/irc";

/** Newest messages the panel lists; the full history stays in the IRC viewer. */
const IRC_PANEL_ENTRIES = 100;

/** What the IRC section needs from its host. */
export interface IrcSectionHost {
	/** The operator IRC history the `app.irc.viewer` overlay reads. */
	readonly source: IrcLogSource;
	/** Open the full IRC viewer. */
	openViewer(): void;
	requestRender(): void;
}

class IrcContent implements MouseRoutable {
	readonly #host: IrcSectionHost;
	readonly #unsubscribe: () => void;

	constructor(host: IrcSectionHost) {
		this.#host = host;
		this.#unsubscribe = host.source.subscribe(() => host.requestRender());
	}

	render(width: number): readonly string[] {
		const entries = this.#host.source.entries();
		if (entries.length === 0) return [];
		const lines: string[] = [];
		// Newest first, so the top of the panel is the latest traffic without scrolling.
		for (let index = entries.length - 1; index >= Math.max(0, entries.length - IRC_PANEL_ENTRIES); index--) {
			lines.push(...this.#entryLines(entries[index]!, width));
		}
		return lines;
	}

	#entryLines(entry: IrcLogEntry, width: number): string[] {
		const { message } = entry;
		const names = `${sanitizeDisplaySingleLine(message.from)} ${theme.fg("accent", theme.nav.selected)} ${sanitizeDisplaySingleLine(message.to)}`;
		const failed = entry.outcome === "failed" ? theme.fg("error", " failed") : "";
		const head = `${theme.fg("dim", clockTime(message.ts))} ${names}${failed}`;
		const body = sanitizeDisplaySingleLine(message.body);
		return [
			truncateToWidth(head, width, ""),
			truncateToWidth(` ${theme.fg("dim", theme.md.quoteBorder)} ${theme.fg("toolOutput", body)}`, width),
		];
	}

	routeMouse(event: SgrMouseEvent): void {
		if (event.leftClick) this.#host.openViewer();
	}

	invalidate(): void {}

	dispose(): void {
		this.#unsubscribe();
	}
}

/**
 * The IRC view of the side panel: the newest agent-to-agent messages from the
 * operator IRC history, newest first, one header and one body line each. It
 * reads the same history as the `app.irc.viewer` overlay; clicking it opens
 * that viewer for the full log, filtering and replies.
 */
export class IrcSection implements SidePanelSection {
	readonly id = "irc";
	readonly title = "IRC";
	readonly order = 10;
	collapsed?: boolean;
	readonly content: IrcContent;

	constructor(host: IrcSectionHost) {
		this.content = new IrcContent(host);
	}
}
