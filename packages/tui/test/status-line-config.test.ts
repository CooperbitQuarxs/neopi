import { beforeAll, describe, expect, it } from "bun:test";
import type { UsageReport } from "@oh-my-pi/pi-ai/usage";
import {
	parseStatusLineEditorDraft,
	StatusLineConfigOverlayComponent,
	type StatusLineConfigCallbacks,
	type StatusLineEditorDraft,
	type StatusLineLayout,
} from "../src/overlays/status-line-config";
import { initTheme } from "../src/theme";
import { getComposerStyle, visibleWidth } from "../src/index";
import { installExtensionComposerShape } from "../src/overlays/composer-shape-registry";

beforeAll(async () => {
	await initTheme();
});

const ESC = "\x1b";
const CTRL_E = "\x05";
const CTRL_Y = "\x19";
const CTRL_D = "\x04";
const CTRL_U = "\x15";
const BACKSPACE = "\x7f";

const ACTIVE: StatusLineLayout = {
	composerShape: "band",
	leftSegments: ["model", "context_bar"],
	rightSegments: ["time"],
	usageTemplates: {},
};

/** Thirty extra quota windows so the list is taller than the default viewport. */
const MANY_WINDOWS: UsageReport[] = [
	{
		provider: "acme",
		fetchedAt: 1,
		limits: Array.from({ length: 30 }, (_, index) => ({
			id: `acme:w${index}`,
			label: `W${index}`,
			scope: { provider: "acme", windowId: `w${index}` },
			amount: { unit: "percent" as const, usedFraction: 0.1 },
		})),
	},
];

function setup(overrides: Partial<StatusLineConfigCallbacks> = {}, active: StatusLineLayout = ACTIVE) {
	const applied: StatusLineLayout[] = [];
	const drafts: StatusLineEditorDraft[] = [];
	const previews: (StatusLineLayout | undefined)[] = [];
	const notices: string[] = [];
	let closed = false;
	const overlay = new StatusLineConfigOverlayComponent({
		active: () => structuredClone(active),
		saveDraft: async draft => {
			drafts.push(structuredClone(draft));
		},
		apply: async layout => {
			applied.push(structuredClone(layout));
		},
		preview: layout => {
			previews.push(layout && structuredClone(layout));
		},
		close: () => {
			closed = true;
		},
		requestRender: () => {},
		notify: message => notices.push(message),
		...overrides,
	});
	// Size the viewport the way a frame would before keys arrive.
	overlay.render(160);
	return {
		overlay,
		applied,
		drafts,
		previews,
		notices,
		closed: () => closed,
		press: (...keys: string[]) => {
			for (const key of keys) overlay.handleInput(key);
		},
		/** The latest autosaved draft, after pending writes settle. */
		draft: async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
			return drafts.at(-1)!;
		},
		title: () => Bun.stripANSI(overlay.render(160)[0] ?? ""),
		text: () => Bun.stripANSI(overlay.render(160).join("\n")),
	};
}

describe("status-line editor list", () => {
	it("toggles widgets in place: the row and the selection stay put", async () => {
		const h = setup();
		h.press("j", " ");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar"]);
		let draft = await h.draft();
		expect(draft.selected).toBe("model");
		expect(draft.left.map(row => row.id)).toEqual(["model", "context_bar"]);
		expect(draft.left[0]).toEqual({ id: "model", enabled: false });
		// The next row is still the neighbor it was before the toggle.
		h.press("j");
		draft = await h.draft();
		expect(draft.selected).toBe("context_bar");
		h.press("k", " ");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["model", "context_bar"]);
	});

	it("moves widgets with h/l along the status line and across the side boundary", () => {
		const h = setup();
		h.press("j", "l");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar", "model"]);
		h.press("l");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar"]);
		expect(h.previews.at(-1)?.rightSegments).toEqual(["model", "time"]);
		h.press("h");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar", "model"]);
		expect(h.previews.at(-1)?.rightSegments).toEqual(["time"]);
	});

	it("scrolls the view with Ctrl-e/Ctrl-y without moving the selection, and motion reveals it again", async () => {
		const h = setup({ usageReports: MANY_WINDOWS });
		h.press(CTRL_E, CTRL_E, CTRL_E);
		let draft = await h.draft();
		expect(draft.top).toBe(3);
		expect(draft.selected).toBe("composer");
		h.press(CTRL_Y);
		draft = await h.draft();
		expect(draft.top).toBe(2);
		expect(draft.selected).toBe("composer");
		// Model is list line 2 (composer, "Left side", model); motion scrolls back just enough to show it.
		h.press(CTRL_E, CTRL_E, "j");
		draft = await h.draft();
		expect(draft.selected).toBe("model");
		expect(draft.top).toBe(2);
	});

	it("jumps with gg/G and pages by half a view with Ctrl-d/Ctrl-u", async () => {
		const h = setup({ usageReports: MANY_WINDOWS });
		h.press("G");
		expect((await h.draft()).selected).toBe("reset");
		h.press("g", "g");
		expect((await h.draft()).selected).toBe("composer");
		h.press(CTRL_D);
		const down = await h.draft();
		expect(down.selected).not.toBe("composer");
		h.press(CTRL_U);
		expect((await h.draft()).selected).toBe("composer");
	});

	it("cycles the composer with < and > while the selection and viewport stay put", async () => {
		const h = setup({ usageReports: MANY_WINDOWS });
		h.press("j", "j", "j", CTRL_E);
		const before = await h.draft();
		h.press(">");
		const after = await h.draft();
		expect(h.previews.at(-1)?.composerShape).not.toBe("band");
		expect(after.selected).toBe(before.selected);
		expect(after.top).toBe(before.top);
		h.press("<");
		expect(h.previews.at(-1)?.composerShape).toBe("band");
		expect((await h.draft()).selected).toBe(before.selected);
	});

	it("filters with / using literal text; Esc returns to the list keeping the filter visible", async () => {
		const h = setup();
		h.press("/", "t", "i", "m", "e");
		let draft = await h.draft();
		expect(draft.focus).toBe("search");
		expect(draft.query).toBe("time");
		expect(draft.selected).toBe("time");
		expect(h.text()).not.toContain("Context bar");
		h.press(ESC);
		draft = await h.draft();
		expect(draft.focus).toBe("list");
		expect(draft.query).toBe("time");
		expect(h.text()).toContain("time");
		expect(h.closed()).toBe(false);
		// Nothing is pending, so the next Esc leaves the editor like any menu.
		h.press(ESC);
		expect(h.closed()).toBe(true);
	});

	it("lists discovered quota windows and configured ids, enabling them as ordinary widgets", () => {
		const h = setup(
			{
				usageReports: [
					{
						provider: "anthropic",
						fetchedAt: 1,
						limits: [
							{
								id: "short",
								label: "Short",
								scope: { provider: "anthropic", windowId: "5h" },
								amount: { unit: "percent", usedFraction: 0.1 },
							},
							{
								id: "tier",
								label: "Tier",
								scope: { provider: "anthropic", windowId: "7d", tier: " FABLE " },
								amount: { unit: "percent", usedFraction: 0.2 },
							},
						],
					},
				],
			},
			{ ...ACTIVE, leftSegments: ["usage:custom:month"], rightSegments: [] },
		);
		const rows = h.overlay.render(200);
		expect(rows.every(row => visibleWidth(row) <= 200)).toBe(true);
		expect(h.text()).toContain("AN 5h");
		expect(h.text()).toContain("Fable");
		// The last widget row is the newest discovered window; the Reset row sits below it.
		h.press("G", "k", " ");
		expect(h.previews.at(-1)?.rightSegments).toEqual(["usage:anthropic:7d:fable"]);
	});

	it("cycles through registered extension shapes as well as builtins", () => {
		const unregister = installExtensionComposerShape({
			label: "Extension Preview",
			description: "Registered shape",
			style: { ...getComposerStyle("rail"), id: "configuration-test-shape" },
		});
		try {
			const h = setup({}, { ...ACTIVE, composerShape: "rail" });
			h.press(" ");
			expect(h.previews.at(-1)?.composerShape).toBe("configuration-test-shape");
			expect(h.text()).toContain("Extension Preview");
		} finally {
			unregister();
		}
	});
});

describe("status-line editor templates", () => {
	it("edits the text around one usage widget's percentage without touching its siblings", async () => {
		const h = setup({}, { ...ACTIVE, rightSegments: ["usage:anthropic:5h", "usage:anthropic:7d"] });
		h.press("j", "j", "j", "\t");
		expect((await h.draft()).focus).toBe("template");
		h.press(...Array.from({ length: 30 }, () => BACKSPACE), ..."{percent} used".split(""), "\r");
		const draft = await h.draft();
		expect(draft.focus).toBe("list");
		expect(h.previews.at(-1)?.usageTemplates).toEqual({ "usage:anthropic:5h": "{percent} used" });
		// Restoring the default text removes the override rather than storing a copy.
		h.press("\t", ...Array.from({ length: 30 }, () => BACKSPACE), "\r");
		expect(h.previews.at(-1)?.usageTemplates).toEqual({});
	});

	it("explains instead of opening a template for widgets that have none", () => {
		const h = setup();
		h.press("j", "\t");
		expect(h.notices.at(-1)).toContain("usage widget");
	});
});

describe("status-line editor draft", () => {
	it("applies with s and stays open", async () => {
		const h = setup();
		h.press("j", " ");
		expect(h.title()).toContain("unapplied draft");
		h.press("s");
		await Bun.sleep(0);
		expect(h.applied).toEqual([{ ...ACTIVE, leftSegments: ["context_bar"] }]);
		expect(h.closed()).toBe(false);
		expect(h.title()).not.toContain("unapplied draft");
		// Esc after applying closes without a prompt.
		h.press(ESC);
		expect(h.closed()).toBe(true);
	});

	it("asks on Esc: Esc/c stays, n keeps the draft and leaves the active layout, y applies", async () => {
		const declined = setup();
		declined.press("j", " ", ESC);
		expect(declined.closed()).toBe(false);
		declined.press("c");
		expect(declined.closed()).toBe(false);
		declined.press(ESC, ESC);
		expect(declined.closed()).toBe(false);
		declined.press(ESC, "n");
		expect(declined.closed()).toBe(true);
		expect(declined.applied).toEqual([]);
		expect(declined.previews.at(-1)).toBeUndefined();
		const kept = await declined.draft();
		expect(kept.left.find(row => row.id === "model")?.enabled).toBe(false);
		expect(declined.notices.at(-1)).toContain("Kept the unapplied");

		const accepted = setup();
		accepted.press("j", " ", ESC, "y");
		await Bun.sleep(0);
		expect(accepted.applied).toEqual([{ ...ACTIVE, leftSegments: ["context_bar"] }]);
		expect(accepted.closed()).toBe(true);
	});

	it("restores every edit and the editor state when reopened from the saved draft", async () => {
		const first = setup({ usageReports: MANY_WINDOWS });
		first.press("j", " ", "j", "l", ">", CTRL_E, CTRL_E);
		const saved = await first.draft();
		expect(saved.top).toBe(2);
		first.press(ESC, "n");
		expect(first.closed()).toBe(true);
		const restoredDraft = parseStatusLineEditorDraft(JSON.parse(JSON.stringify(saved)));
		expect(restoredDraft).toEqual(saved);

		const second = setup({ draft: restoredDraft, usageReports: MANY_WINDOWS });
		expect(second.previews[0]).toEqual(first.previews.findLast(layout => layout !== undefined));
		expect(second.notices[0]).toContain("Restored the unapplied status-line draft");
		second.press(CTRL_Y);
		const reopened = await second.draft();
		expect(reopened.selected).toBe(saved.selected);
		expect(reopened.left).toEqual(saved.left);
		expect(reopened.right).toEqual(saved.right);
		expect(reopened.composerShape).toBe(saved.composerShape);
		expect(reopened.top).toBe(saved.top - 1);
	});

	it("lets a draft without edits follow a newer active layout, keeping widget positions", () => {
		const base: StatusLineLayout = { ...ACTIVE };
		const draft: StatusLineEditorDraft = {
			version: 1,
			base,
			composerShape: "band",
			left: [
				{ id: "pi", enabled: false },
				{ id: "model", enabled: true },
				{ id: "context_bar", enabled: true },
			],
			right: [{ id: "time", enabled: true }],
			usageTemplates: {},
			selected: "pi",
			top: 0,
			focus: "list",
			query: "",
		};
		const changed: StatusLineLayout = { ...ACTIVE, leftSegments: ["context_bar", "model"], composerShape: "box" };
		const h = setup({ draft }, changed);
		expect(h.previews[0]).toEqual(changed);
		expect(h.notices).toEqual([]);
		expect(h.title()).not.toContain("unapplied draft");
	});

	it("resets to the active layout only after an explicit confirmation", async () => {
		const h = setup();
		h.press("j", " ", ">", "R", "n");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar"]);
		h.press("R", "y");
		expect(h.previews.at(-1)).toEqual(ACTIVE);
		expect(h.title()).not.toContain("unapplied draft");
		// The Reset row at the bottom is the same path.
		h.press(" ", "G", " ", "y");
		expect(h.previews.at(-1)).toEqual(ACTIVE);
		const draft = await h.draft();
		expect(draft.base).toEqual(ACTIVE);
	});

	it("keeps the draft when applying fails", async () => {
		const failure = Promise.withResolvers<void>();
		const h = setup({
			apply: async () => {
				failure.resolve();
				throw new Error("disk full");
			},
		});
		h.press("j", " ", "s");
		await failure.promise;
		await Bun.sleep(0);
		expect(h.notices.at(-1)).toContain("Could not apply");
		expect(h.notices.at(-1)).toContain("disk full");
		// Host statuses sit behind the fullscreen editor; its own footer repeats the failure.
		expect(h.text()).toContain("Could not apply the status-line layout");
		expect(h.closed()).toBe(false);
		expect(h.title()).toContain("unapplied draft");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar"]);
	});

	it("reports a failing draft write once and never applies on its behalf", async () => {
		let attempts = 0;
		const h = setup({
			saveDraft: async () => {
				attempts++;
				throw new Error("read-only");
			},
		});
		h.press("j", " ");
		await Bun.sleep(0);
		h.press(" ", " ");
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(attempts).toBeGreaterThan(1);
		expect(h.notices.filter(notice => notice.includes("Could not save the status-line draft"))).toHaveLength(1);
		expect(h.applied).toEqual([]);
		expect(h.title()).toContain("draft not saved");
	});

	it("leaves for menu history without a prompt, saving the draft and restoring the live view", async () => {
		const h = setup();
		h.press("j", " ");
		h.overlay.leaveMenu();
		expect(h.previews.at(-1)).toBeUndefined();
		expect(h.closed()).toBe(false);
		const draft = await h.draft();
		expect(draft.left.find(row => row.id === "model")?.enabled).toBe(false);
		h.press(" ");
		expect(h.previews.at(-1)).toBeUndefined();
	});

	it("rejects malformed drafts and drops unknown widgets from usable ones", () => {
		expect(parseStatusLineEditorDraft({ version: 2 })).toBeUndefined();
		expect(parseStatusLineEditorDraft(null)).toBeUndefined();
		const parsed = parseStatusLineEditorDraft({
			version: 1,
			base: ACTIVE,
			composerShape: "band",
			left: [
				{ id: "model", enabled: true },
				{ id: "not-a-widget", enabled: true },
				{ id: "model", enabled: false },
			],
			right: [],
			usageTemplates: { "usage:anthropic:5h": "{percent}", model: "x" },
			selected: "model",
			top: -4,
			focus: "elsewhere",
			query: "a\nb",
		});
		expect(parsed?.left).toEqual([{ id: "model", enabled: true }]);
		expect(parsed?.usageTemplates).toEqual({ "usage:anthropic:5h": "{percent}" });
		expect(parsed?.top).toBe(0);
		expect(parsed?.focus).toBe("list");
		expect(parsed?.query).not.toContain("\n");
	});
});
