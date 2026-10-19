import type { MouseRoutable, SgrMouseEvent } from "@oh-my-pi/pi-tui";
import type { SidePanelPointerAware, SidePanelSection } from "@oh-my-pi/pi-tui/chrome";
import type { AgentRecordLike } from "@oh-my-pi/pi-tui/overlays/agent-hub-types";
import { statusGlyph } from "@oh-my-pi/pi-tui/overlays/agent-hub-renderer";
import { sanitizeDisplaySingleLine } from "@oh-my-pi/pi-tui/overlays/extensions/display-text";
import { truncateToWidth } from "@oh-my-pi/pi-tui/render/render-utils";
import { theme } from "@oh-my-pi/pi-tui/theme";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

/** What the agents section needs from its host. */
export interface AgentsSectionHost {
	/** This UI's roster, already scoped to its root (the Agent Hub's list). */
	agents(): readonly AgentRecordLike[];
	/** The agent whose transcript the main area shows, or undefined for the primary session. */
	focusedAgentId(): string | undefined;
	/** Show `id`'s transcript in the main area; the host surfaces focus failures. */
	focus(id: string): void | Promise<void>;
	/** Return the main area to the primary session. */
	returnToPrimary(): void;
	requestRender(): void;
	/** Roster change notifications (spawn, status, activity); returns the unsubscribe. */
	onChange(listener: () => void): () => void;
}

/** Roster kinds the panel lists: subagents and advisors (advisors are read-only transcripts). */
function isListed(ref: AgentRecordLike): boolean {
	return ref.kind === "sub" || ref.kind === "advisor";
}

class AgentsContent implements MouseRoutable, SidePanelPointerAware {
	readonly #host: AgentsSectionHost;
	readonly #unsubscribe: () => void;
	/** Agent id per rendered body row, from the last render. */
	#rowIds: readonly (string | undefined)[] = [];
	#hovered: string | undefined;
	#pendingFocus: { id: string } | undefined;

	constructor(host: AgentsSectionHost) {
		this.#host = host;
		this.#unsubscribe = host.onChange(() => host.requestRender());
	}

	render(width: number): readonly string[] {
		// Spawn order only: a status change (a click reviving a parked agent) must
		// not move rows, or a second click on the same spot would hit another agent.
		const agents = this.#host
			.agents()
			.filter(isListed)
			.toSorted((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		const ids: (string | undefined)[] = [];
		if (agents.length === 0) {
			this.#hovered = undefined;
			this.#rowIds = ids;
			return [];
		}
		const focused = this.#host.focusedAgentId();
		const lines: string[] = [];
		for (const ref of agents) {
			lines.push(this.#row(ref, width, ref.id === focused, ref.id === this.#hovered));
			ids.push(ref.id);
		}
		// A hovered agent that left the roster no longer bands anything.
		if (this.#hovered !== undefined && !ids.includes(this.#hovered)) this.#hovered = undefined;
		lines.push(theme.fg("dim", truncateToWidth(focused ? "click again to return to main" : "click to view", width)));
		ids.push(undefined);
		this.#rowIds = ids;
		return lines;
	}

	#row(ref: AgentRecordLike, width: number, focused: boolean, hovered: boolean): string {
		const gutter = focused ? theme.fg("accent", "▍") : " ";
		const name = sanitizeDisplaySingleLine(ref.id);
		const role = ref.history?.agent;
		const roleText = role && role !== ref.id ? theme.fg("muted", ` ${sanitizeDisplaySingleLine(role)}`) : "";
		const advisor = ref.kind === "advisor" ? theme.fg("warning", " read-only") : "";
		const head = `${gutter}${statusGlyph(ref.status)} ${focused ? theme.bold(theme.fg("accent", name)) : name}${roleText}${advisor}`;
		const activity = ref.activity ? sanitizeDisplaySingleLine(ref.activity) : "";
		const room = width - visibleWidth(head) - 1;
		const line = activity && room > 3 ? `${head} ${theme.fg("dim", truncateToWidth(activity, room))}` : head;
		const fitted = truncateToWidth(line, width, "");
		if (!hovered) return fitted;
		return theme.bgFill("selectedBg", fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted))));
	}

	routeMouse(event: SgrMouseEvent, line: number): void {
		const id = this.#rowIds[line];
		if (event.motion) {
			this.#setHovered(id);
			return;
		}
		if (!event.leftClick) return;
		if (id === undefined) {
			this.clickEmpty();
			return;
		}
		if (id === this.#host.focusedAgentId() || id === this.#pendingFocus?.id) {
			this.#pendingFocus = undefined;
			this.#host.returnToPrimary();
			return;
		}
		const completion = this.#host.focus(id);
		if (completion) {
			const pending = { id };
			this.#pendingFocus = pending;
			const settled = () => {
				if (this.#pendingFocus === pending) this.#pendingFocus = undefined;
			};
			void completion.then(settled, settled);
		} else {
			this.#pendingFocus = undefined;
		}
	}

	/** A click on panel space with no agent row: return to the primary session if an agent is shown. */
	clickEmpty(): void {
		// Even before a parked agent finishes reviving, empty space cancels that focus request.
		if (this.#host.focusedAgentId() === undefined && this.#pendingFocus === undefined) return;
		this.#pendingFocus = undefined;
		this.#host.returnToPrimary();
	}

	pointerLeave(): void {
		this.#setHovered(undefined);
	}

	invalidate(): void {}

	dispose(): void {
		this.#unsubscribe();
	}

	#setHovered(id: string | undefined): void {
		if (id === this.#hovered) return;
		this.#hovered = id;
		this.#host.requestRender();
	}
}

/**
 * The Agents view of the side panel: a compact Agent Hub roster of this
 * session's subagents and advisors. Hovering bands a row; clicking one shows
 * that agent's transcript in the main area through the same focus path as the
 * hub and Ctrl+S, and clicking it again (or empty panel space) returns to the
 * primary session. The panel only navigates: messaging, revival and kill stay
 * in the hub with its permissions, and advisors stay read-only.
 */
export class AgentsSection implements SidePanelSection {
	readonly id = "agents";
	readonly title = "AGENTS";
	readonly order = 10;
	collapsed?: boolean;
	readonly content: AgentsContent;

	constructor(host: AgentsSectionHost) {
		this.content = new AgentsContent(host);
	}

	/** Left click on panel space outside every section row. */
	clickEmpty(): void {
		this.content.clickEmpty();
	}
}
