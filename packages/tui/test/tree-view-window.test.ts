import { beforeAll, describe, expect, it } from "bun:test";
import { TreeView } from "../src/components/tree-view";
import { getThemeByName, type Theme } from "../src/theme";

let darkTheme: Theme;
beforeAll(async () => {
	const loaded = await getThemeByName("dark");
	if (!loaded) throw new Error("dark theme unavailable");
	darkTheme = loaded;
});

function create() {
	return new TreeView({
		roots: Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` })),
		getKey: node => node.id,
		getChildren: () => [],
		theme: darkTheme,
		maxRows: 3,
		selectedKey: "row-0",
		renderPrefix: () => ({ first: "", continuation: "" }),
		renderLeading: () => "",
		renderRow: node => node.id,
	});
}

describe("TreeView explicit logical window", () => {
	it("renders the owner's range without moving selection and keys its cache by that range", () => {
		const view = create();
		try {
			const first = view.renderWithState(40, { startIndex: 2, endIndex: 5 });
			expect(first).toMatchObject({ windowStart: 2, windowEnd: 5, totalRows: 10 });
			expect(first.lines.map(line => Bun.stripANSI(line))).toEqual(["row-2", "row-3", "row-4"]);
			expect(view.selectedKey).toBe("row-0");
			expect(view.renderWithState(40, { startIndex: 2, endIndex: 5 })).toBe(first);
			const next = view.renderWithState(40, { startIndex: 3, endIndex: 6 });
			expect(next.lines.map(line => Bun.stripANSI(line))).toEqual(["row-3", "row-4", "row-5"]);
			expect(view.renderWithState(40).windowStart).toBe(0);
		} finally {
			view.dispose();
		}
	});

	it("clamps an explicit end to available rows while keeping the default centered path intact", () => {
		const view = create();
		try {
			view.setSelectedKey("row-8");
			expect(view.renderWithState(40, { startIndex: 8, endIndex: 100 })).toMatchObject({
				windowStart: 8,
				windowEnd: 10,
			});
			expect(view.renderWithState(40)).toMatchObject({ windowStart: 7, windowEnd: 10 });
		} finally {
			view.dispose();
		}
	});
});
