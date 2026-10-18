import { beforeAll, describe, expect, it } from "bun:test";
import {
	StatusLineConfigOverlayComponent,
	type StatusLineConfigCallbacks,
	type StatusLineConfigDraft,
} from "../src/overlays/status-line-config";
import { initTheme } from "../src/theme";
import { getComposerStyle, visibleWidth } from "../src/index";
import { installExtensionComposerShape } from "../src/overlays/composer-shape-registry";

beforeAll(async () => {
	await initTheme();
});

const DOWN = "\x1b[B";

function setup(overrides: Partial<StatusLineConfigCallbacks> = {}) {
	const initial: StatusLineConfigDraft = {
		composerShape: "band",
		leftSegments: ["model", "context_bar"],
		rightSegments: ["time"],
	};
	const saved: StatusLineConfigDraft[] = [];
	const previews: (StatusLineConfigDraft | undefined)[] = [];
	const notices: string[] = [];
	let closed = false;
	const overlay = new StatusLineConfigOverlayComponent({
		load: () => initial,
		save: async draft => {
			saved.push(structuredClone(draft));
		},
		preview: draft => {
			previews.push(draft && structuredClone(draft));
		},
		close: () => {
			closed = true;
		},
		requestRender: () => {},
		notify: message => notices.push(message),
		...overrides,
	});
	return {
		overlay,
		initial,
		saved,
		previews,
		notices,
		closed: () => closed,
		press: (...keys: string[]) => {
			for (const key of keys) overlay.handleInput(key);
		},
	};
}

describe("status-line configuration", () => {
	it("reorders widgets, crosses group boundaries, toggles, and saves the draft", async () => {
		const h = setup();
		h.press(DOWN, "]"); // Model moves after the context bar.
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar", "model"]);
		h.press("]"); // Moving past the end of left enters the start of right.
		expect(h.previews.at(-1)?.rightSegments).toEqual(["model", "time"]);
		h.press("\t"); // Explicit group switch appends to left.
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar", "model"]);
		h.press(" ");
		expect(h.previews.at(-1)?.leftSegments).toEqual(["context_bar"]);
		h.press(" ", "["); // Re-enable at end of left, then reorder upward.
		h.press("s");
		await Bun.sleep(0);
		expect(h.saved).toEqual([h.initial]);
		expect(h.closed()).toBe(true);
	});

	it("previews composer changes and restores the original layout on cancel", () => {
		const h = setup();
		h.press("\r");
		expect(h.previews.at(-1)?.composerShape).toBe("box");
		h.press(DOWN, DOWN, "\x1b[1;3A", "\x1b");
		expect(h.previews.at(-1)).toBeUndefined();
		expect(h.saved).toEqual([]);
		expect(h.notices).toEqual(["Discarded unsaved status-line changes."]);
		expect(h.initial.leftSegments).toEqual(["model", "context_bar"]);
		expect(h.closed()).toBe(true);
	});
	it("lists discovered quota windows and configured ids, enabling them as ordinary widgets", async () => {
		const h = setup({
			load: () => ({ composerShape: "band", leftSegments: ["usage:custom:month"], rightSegments: [] }),
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
		});
		h.press("\x1b[F");
		const rows = h.overlay.render(200);
		expect(rows.every(row => visibleWidth(row) <= 200)).toBe(true);
		expect(Bun.stripANSI(rows.join("\n"))).toContain("AN 5h");
		expect(Bun.stripANSI(rows.join("\n"))).toContain("Fable");
		h.press(" ", "s");
		await Bun.sleep(0);
		expect(h.saved[0]?.leftSegments).toEqual(["usage:custom:month", "usage:anthropic:7d:fable"]);
	});

	it("cycles through registered extension shapes as well as builtins", () => {
		const unregister = installExtensionComposerShape({
			label: "Extension Preview",
			description: "Registered shape",
			style: { ...getComposerStyle("rail"), id: "configuration-test-shape" },
		});
		try {
			const h = setup({ load: () => ({ composerShape: "rail", leftSegments: [], rightSegments: [] }) });
			h.press(" ");
			expect(h.previews.at(-1)?.composerShape).toBe("configuration-test-shape");
			expect(Bun.stripANSI(h.overlay.render(100).join("\n"))).toContain("Extension Preview");
			h.press("\x1b");
		} finally {
			unregister();
		}
	});
});
