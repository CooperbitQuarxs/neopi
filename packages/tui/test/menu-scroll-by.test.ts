import { describe, expect, it } from "bun:test";
import { menuScrollBy } from "../src/components/menu-navigation";

describe("native menu scroll mapping", () => {
	it("maps supported motions without replacing unsupported half pages", () => {
		expect(menuScrollBy({ kind: "move", delta: -1 })).toBe("line-up");
		expect(menuScrollBy({ kind: "move", delta: 1 })).toBe("line-down");
		expect(menuScrollBy({ kind: "scroll", delta: -1 })).toBe("line-up");
		expect(menuScrollBy({ kind: "scroll", delta: 1 })).toBe("line-down");
		expect(menuScrollBy({ kind: "page", delta: -1 })).toBe("page-up");
		expect(menuScrollBy({ kind: "page", delta: 1 })).toBe("page-down");
		expect(menuScrollBy({ kind: "boundary", edge: "first" })).toBe("start");
		expect(menuScrollBy({ kind: "boundary", edge: "last" })).toBe("end");
		expect(menuScrollBy({ kind: "halfPage", delta: -1 })).toBeUndefined();
		expect(menuScrollBy({ kind: "halfPage", delta: 1 })).toBeUndefined();
		expect(menuScrollBy({ kind: "horizontal", delta: 1 })).toBeUndefined();
		expect(menuScrollBy({ kind: "confirm" })).toBeUndefined();
	});
});
