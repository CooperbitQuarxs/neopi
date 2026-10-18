import { describe, expect, it } from "bun:test";
import { MenuViewport } from "../src/components/menu-navigation";

describe("menu viewport visual lines", () => {
	it("clips a leading item one line at a time and keeps snapshots immutable", () => {
		const view = new MenuViewport();
		view.layout([3, 3, 3], 0, 4);
		view.scroll(1);
		expect(view.layout([3, 3, 3], 0, 4)).toEqual({ startIndex: 0, endIndex: 2, lineOffset: 1, rowOffset: 1, totalRows: 9 });
		const saved = view.top;
		view.scroll(1);
		expect(view.layout([3, 3, 3], 0, 4).lineOffset).toBe(2);
		expect(saved).toEqual({ item: 0, lineOffset: 1 });
		view.setTop(saved);
		expect(view.layout([3, 3, 3], 0, 4).lineOffset).toBe(1);
		view.reveal();
		expect(view.layout([3, 3, 3], 0, 4).lineOffset).toBe(0);
	});

	it("scrolls within one item taller than the viewport and clamps at its last line window", () => {
		const view = new MenuViewport();
		view.layout([10], 0, 4);
		view.scroll(1);
		expect(view.layout([10], 0, 4).lineOffset).toBe(1);
		view.scroll(20);
		expect(view.layout([10], 0, 4).lineOffset).toBe(6);
		view.scroll(-1);
		expect(view.layout([10], 0, 4).lineOffset).toBe(5);
	});

	it("accepts numeric item-boundary snapshots and preserves single-row scrolling", () => {
		const view = new MenuViewport();
		view.setTop(1);
		expect(view.layout([1, 1, 1, 1, 1], 0, 2)).toMatchObject({ startIndex: 1, lineOffset: 0, rowOffset: 1 });
		view.scroll(1);
		expect(view.layout([1, 1, 1, 1, 1], 0, 2)).toMatchObject({ startIndex: 2, lineOffset: 0, rowOffset: 2 });
		view.scroll(-1);
		expect(view.layout([1, 1, 1, 1, 1], 0, 2)).toMatchObject({ startIndex: 1, lineOffset: 0, rowOffset: 1 });
	});
});
