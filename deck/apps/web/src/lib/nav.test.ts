import { describe, expect, test } from "bun:test";
import { NAV_ITEMS, navItemForPath } from "./nav";
import { NAV_ITEMS as NEO_NAV_ITEMS, navItemForPath as neoNavItemForPath } from "../neo/nav";

describe("navItemForPath", () => {
	test("legacy home matches only its exact root", () => {
		expect(navItemForPath("/legacy")?.label).toBe("Home");
		expect(navItemForPath("/legacy/inbox")?.label).toBe("Inbox");
		expect(navItemForPath("/inbox")).toBeUndefined();
	});

	test("nested routes light their section", () => {
		expect(navItemForPath("/legacy/routines/abc/runs/xyz")?.label).toBe("Routines");
	});

	test("the legacy /chat path lights Threads", () => {
		expect(navItemForPath("/legacy/chat")?.label).toBe("Threads");
		expect(navItemForPath("/legacy/threads")?.label).toBe("Threads");
	});

	test("unknown paths light nothing", () => {
		expect(navItemForPath("/nowhere")).toBeUndefined();
	});

	test("hotkeys are unique so `g` + letter is unambiguous", () => {
		const keys = NAV_ITEMS.map((i) => i.hotkey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("Neo navigation", () => {
	test("matches each place and its detail pages", () => {
		for (const item of NEO_NAV_ITEMS) {
			expect(neoNavItemForPath(item.to)).toBe(item);
			expect(neoNavItemForPath(`${item.to}/detail`)).toBe(item);
		}
		expect(neoNavItemForPath("/")).toBeUndefined();
		expect(neoNavItemForPath("/boardwalk")).toBeUndefined();
	});

	test("keeps route chords unambiguous", () => {
		const keys = NEO_NAV_ITEMS.map((item) => item.hotkey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
