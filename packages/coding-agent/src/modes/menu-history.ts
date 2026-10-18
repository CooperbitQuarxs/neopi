/**
 * Menu visitation timeline behind `app.navigation.back` (Ctrl-O) and
 * `app.navigation.forward` (Ctrl-I / Alt-O).
 *
 * Every visit to a view — opening a menu, a nested page, or returning to the
 * conversation by closing one — is appended at the latest end. Unlike browser
 * history, a visit made from an older position never truncates the newer
 * entries. Back from a freshly visited entry returns to the view it was
 * entered from (its origin); every other back/forward step walks the timeline
 * chronologically. So after going back from B to A and opening C from A:
 *
 *   timeline [A, B, C]   C ─back→ A ─forward→ B ─forward→ C
 */
export interface MenuHistoryEntry<L extends string, S> {
	readonly location: L;
	/** Snapshot recorded when the view was last left; restored when history returns to it. */
	state: S | undefined;
}

interface TimelineEntry<L extends string, S> extends MenuHistoryEntry<L, S> {
	/** Index this entry was entered from by a fresh visit, when that was not the previous entry. */
	origin: number | undefined;
}

export class MenuHistory<L extends string, S = unknown> {
	#entries: TimelineEntry<L, S>[];
	#cursor = 0;
	/** The cursor reached its entry by a fresh visit (not by back/forward). */
	#arrivedFresh = false;
	readonly #limit: number;

	constructor(initial: L, limit = 100) {
		this.#entries = [{ location: initial, state: undefined, origin: undefined }];
		this.#limit = Math.max(2, limit);
	}

	get current(): MenuHistoryEntry<L, S> {
		return this.#entries[this.#cursor]!;
	}

	/** Locations oldest → newest with the cursor index, for debugging and tests. */
	snapshot(): { locations: L[]; cursor: number } {
		return { locations: this.#entries.map(entry => entry.location), cursor: this.#cursor };
	}

	/**
	 * Record a fresh visit. Visiting the current location is a no-op. Visiting
	 * the location that already ends the timeline moves there instead of
	 * stacking a duplicate.
	 */
	visit(location: L, state?: S): void {
		const current = this.#entries[this.#cursor]!;
		if (current.location === location) {
			if (state !== undefined) current.state = state;
			return;
		}
		const from = this.#cursor;
		const lastIndex = this.#entries.length - 1;
		const last = this.#entries[lastIndex]!;
		if (last.location === location) {
			if (state !== undefined) last.state = state;
			last.origin = from === lastIndex - 1 ? undefined : from;
			this.#cursor = lastIndex;
		} else {
			this.#entries.push({ location, state, origin: from === lastIndex ? undefined : from });
			this.#cursor = this.#entries.length - 1;
			this.#trim();
		}
		this.#arrivedFresh = true;
	}

	/** Store `state` on the nearest entry at or before the cursor for `location`. */
	recordState(location: L, state: S | undefined): void {
		for (let index = this.#cursor; index >= 0; index--) {
			const entry = this.#entries[index]!;
			if (entry.location !== location) continue;
			entry.state = state;
			return;
		}
	}

	/** Whether {@link back} (-1) or {@link forward} (+1) has an entry to show. */
	canGo(direction: -1 | 1): boolean {
		return this.#target(direction) !== undefined;
	}

	/** Step back; returns the entry to show, or undefined at the oldest entry. */
	back(): MenuHistoryEntry<L, S> | undefined {
		return this.#go(-1);
	}

	/** Step forward; returns the entry to show, or undefined at the newest entry. */
	forward(): MenuHistoryEntry<L, S> | undefined {
		return this.#go(1);
	}

	#go(direction: -1 | 1): MenuHistoryEntry<L, S> | undefined {
		const target = this.#target(direction);
		if (target === undefined) return undefined;
		this.#cursor = target;
		this.#arrivedFresh = false;
		return this.#entries[target];
	}

	#target(direction: -1 | 1): number | undefined {
		if (direction > 0) return this.#cursor < this.#entries.length - 1 ? this.#cursor + 1 : undefined;
		const current = this.#entries[this.#cursor]!;
		const target = this.#arrivedFresh && current.origin !== undefined ? current.origin : this.#cursor - 1;
		return target >= 0 ? target : undefined;
	}

	/** Drop the oldest entries past the limit; never drops entries after the cursor. */
	#trim(): void {
		const excess = this.#entries.length - this.#limit;
		if (excess <= 0) return;
		const dropped = Math.min(excess, this.#cursor);
		if (dropped === 0) return;
		this.#entries.splice(0, dropped);
		this.#cursor -= dropped;
		for (const entry of this.#entries) {
			if (entry.origin === undefined) continue;
			const shifted = entry.origin - dropped;
			entry.origin = shifted >= 0 ? shifted : undefined;
		}
	}
}
