import { beforeAll, describe, expect, it, vi } from "bun:test";
import { BtwHistoryPanel } from "../src/overlays/btw-history-panel";
import type { BtwHistoryRecord } from "../src/overlays/btw-history";
import { initTheme } from "../src/theme/theme";

beforeAll(async () => { await initTheme(); });

const records: BtwHistoryRecord[] = Array.from({ length: 40 }, (_, i) => ({
	id: `question-${i}`, leafId: null, question: `Question ${i}`,
	answer: Array.from({ length: 50 }, (_, row) => `Answer ${i}, line ${row}`).join("\n\n"),
	status: "complete", createdAt: i, updatedAt: i,
}));

function create(options: { onFollowUp?: (record: BtwHistoryRecord, question: string, signal: AbortSignal) => Promise<boolean> } = {}) {
	return new BtwHistoryPanel({ records, onClose: () => {}, onCopy: () => {}, onCancel: () => {},
		canFollowUp: () => true, onFollowUp: options.onFollowUp ?? (async () => true),
		requestRender: () => {}, getHeight: () => 24 });
}

function state(panel: BtwHistoryPanel) {
	return panel.navigationSnapshot() as {
		selectedId: string; focus: string; search: { value: string; focused: boolean; cursor: number }; listTop: unknown;
		composer?: { recordId: string; value: string; cursor: number };
	};
}

describe("BTW menu navigation and safe history", () => {
	it("uses normal list motions, independent scrolling, and literal filter editing", () => {
		const panel = create();
		try {
			panel.render(100);
			panel.handleInput("G");
			expect(state(panel).selectedId).toBe("question-39");
			panel.handleInput("g"); panel.handleInput("g");
			panel.render(100);
			expect(state(panel).selectedId).toBe("question-0");
			const top = state(panel).listTop;
			panel.handleInput("\x05");
			panel.render(100);
			expect(state(panel).selectedId).toBe("question-0");
			expect(state(panel).listTop).not.toEqual(top);
			panel.handleInput("/");
			panel.handleInput("jkG /");
			expect(state(panel).search).toMatchObject({ value: "jkG /", focused: true });
			panel.handleInput("\x1b");
			expect(state(panel).search).toMatchObject({ value: "jkG /", focused: false });
		} finally { panel.dispose(); }
	});

	it("scrolls a narrow two-line row by one visual line and restores that clipped row", () => {
		const panel = create();
		const reopened = create();
		try {
			panel.render(32);
			panel.handleInput("\x05");
			panel.render(32);
			expect(state(panel).selectedId).toBe("question-0");
			expect(state(panel).listTop).toEqual({ item: 0, lineOffset: 1 });
			reopened.restoreNavigation(panel.navigationSnapshot());
			reopened.render(32);
			expect(state(reopened).listTop).toEqual({ item: 0, lineOffset: 1 });
		} finally { panel.dispose(); reopened.dispose(); }
	});

	it("leaves the filter on Tab before moving to the answer pane", () => {
		const panel = create();
		try {
			panel.render(100);
			panel.handleInput("/"); panel.handleInput("Question");
			panel.handleInput("\t");
			panel.handleInput("j");
			expect(state(panel)).toMatchObject({ focus: "answer", search: { value: "Question", focused: false } });
			expect(panel.navigationSnapshot()).toMatchObject({ detail: { scrollOffset: 1 } });
		} finally { panel.dispose(); }
	});

	it("restores pane, selection, query caret, and a safe follow-up draft without submitting", () => {
		const onFollowUp = vi.fn(async () => true);
		const panel = create({ onFollowUp });
		const reopened = create({ onFollowUp });
		try {
			panel.handleInput("/"); panel.handleInput("Question"); panel.handleInput("\x1b[D");
			panel.handleInput("\x1b");
			panel.handleInput("j"); panel.handleInput("l");
			panel.openFollowUp("question-1");
			panel.handleInput("jkG / a safe draft"); panel.handleInput("\x1b[D");
			const saved = panel.navigationSnapshot();
			panel.leaveMenu();
			reopened.restoreNavigation(saved);
			expect(state(reopened)).toMatchObject({
				selectedId: "question-1", focus: "answer", search: { value: "Question", cursor: 7, focused: false },
				composer: { recordId: "question-1", value: "jkG / a safe draft", cursor: 17 },
			});
			expect(onFollowUp).not.toHaveBeenCalled();
			reopened.handleInput("\x1b");
			expect(state(reopened).composer).toBeUndefined();
			expect(reopened.openFollowUp("question-1")).toBe(true);
			expect(state(reopened).composer).toMatchObject({ value: "jkG / a safe draft", cursor: 17 });
		} finally { panel.dispose(); reopened.dispose(); }
	});

	it("blocks history only while a follow-up submission is pending", async () => {
		const accepted = Promise.withResolvers<boolean>();
		const onFollowUp = vi.fn(() => accepted.promise);
		const panel = create({ onFollowUp });
		try {
			panel.openFollowUp("question-0");
			panel.handleInput("safe question");
			expect(panel.blocksMenuHistory).toBe(false);
			panel.handleInput("\r");
			expect(panel.blocksMenuHistory).toBe(true);
			accepted.resolve(false);
			await accepted.promise;
			expect(panel.blocksMenuHistory).toBe(false);
			expect(state(panel).composer?.value).toBe("safe question");
		} finally { panel.dispose(); }
	});
});
