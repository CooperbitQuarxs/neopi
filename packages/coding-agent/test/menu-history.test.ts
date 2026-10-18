import { describe, expect, it } from "bun:test";
import { MenuHistory } from "@oh-my-pi/pi-coding-agent/modes/menu-history";

type Loc = "conversation" | "statusline" | "model" | "settings";

describe("MenuHistory", () => {
	it("returns to a closed menu with its state and forward to the conversation", () => {
		const history = new MenuHistory<Loc, { row: string }>("conversation");
		history.visit("statusline");
		// Esc closes /statusline: its state is recorded, then the conversation is a visit.
		history.recordState("statusline", { row: "usage" });
		history.visit("conversation");

		expect(history.back()).toEqual({ location: "statusline", state: { row: "usage" } });
		expect(history.forward()?.location).toBe("conversation");
		expect(history.forward()).toBeUndefined();
	});

	it("keeps forward visits when a menu opens from older history, and back returns to its origin", () => {
		// Owner's sequence: A=conversation, B=statusline; back to A; open C=model from A.
		const history = new MenuHistory<Loc>("conversation");
		history.visit("statusline");
		expect(history.back()?.location).toBe("conversation");
		history.visit("model");
		expect(history.snapshot()).toEqual({ locations: ["conversation", "statusline", "model"], cursor: 2 });

		// C ─back→ A (where C was entered from) ─forward→ B (the starting spot) ─forward→ C.
		expect(history.back()?.location).toBe("conversation");
		expect(history.forward()?.location).toBe("statusline");
		expect(history.forward()?.location).toBe("model");
		expect(history.forward()).toBeUndefined();
	});

	it("walks chronologically once the fresh entry has been left by back", () => {
		const history = new MenuHistory<Loc>("conversation");
		history.visit("statusline");
		history.back();
		history.visit("model");
		history.back(); // origin: conversation
		history.forward(); // statusline
		history.forward(); // model, reached by forward: back is now chronological
		expect(history.back()?.location).toBe("statusline");
		expect(history.back()?.location).toBe("conversation");
		expect(history.back()).toBeUndefined();
	});

	it("starts from the view where going back began when a menu opens from a menu reached by back", () => {
		// conversation → statusline → Esc (conversation) → back to statusline → open model from it.
		const history = new MenuHistory<Loc>("conversation");
		history.visit("statusline");
		history.visit("conversation");
		expect(history.back()?.location).toBe("statusline");
		history.visit("model");
		expect(history.snapshot().locations).toEqual(["conversation", "statusline", "conversation", "model"]);

		expect(history.back()?.location).toBe("statusline");
		expect(history.forward()?.location).toBe("conversation");
		expect(history.forward()?.location).toBe("model");
	});

	it("moves to the newest entry instead of stacking a duplicate of it", () => {
		const history = new MenuHistory<Loc>("conversation");
		history.visit("statusline");
		history.visit("conversation");
		history.back(); // statusline
		history.visit("conversation"); // Esc again: the newest entry is already the conversation
		expect(history.snapshot()).toEqual({ locations: ["conversation", "statusline", "conversation"], cursor: 2 });
		expect(history.back()?.location).toBe("statusline");
	});

	it("treats a visit to the current location as no visit", () => {
		const history = new MenuHistory<Loc>("conversation");
		history.visit("settings");
		history.visit("settings");
		expect(history.snapshot()).toEqual({ locations: ["conversation", "settings"], cursor: 1 });
	});

	it("drops only the oldest entries past the limit and never the forward ones", () => {
		const history = new MenuHistory<Loc>("conversation", 3);
		history.visit("statusline");
		history.visit("model");
		history.back(); // statusline
		history.back(); // conversation
		history.visit("settings"); // origin is the oldest entry, which the limit drops
		expect(history.snapshot()).toEqual({ locations: ["statusline", "model", "settings"], cursor: 2 });
		// The origin fell off the timeline, so back is chronological.
		expect(history.back()?.location).toBe("model");
	});
});
