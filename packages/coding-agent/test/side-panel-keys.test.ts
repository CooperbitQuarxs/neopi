import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { SidePanelController } from "@oh-my-pi/pi-coding-agent/modes/controllers/side-panel-controller";
import { cfgSidebarEnabled, cfgSidebarView } from "@oh-my-pi/pi-coding-agent/modes/settings";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import { TreeSelectorComponent } from "@oh-my-pi/pi-tui/overlays/tree-selector";
import { COMPOSER_DEFAULTS, Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { SpaceHoldGesture } from "@oh-my-pi/pi-tui/space-hold";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { VirtualRenderScheduler } from "../../tui/test/virtual-render-scheduler";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

const ALT_T = "\x1bt";

/** Real Composer + SidePanelController + InputController listeners; alt+t arrives through the terminal. */
async function harness(columns: number) {
	const term = new VirtualTerminal(columns, 24);
	const scheduler = new VirtualRenderScheduler();
	const composer = new Composer({
		terminal: term,
		tuiOptions: { renderScheduler: scheduler },
		preferences: { ...COMPOSER_DEFAULTS, quiet: true, spellingTypoDetection: false, spellingAutocomplete: "off" },
	});
	composer.setRuntimeChildren([new TranscriptContainer(), new Text("EDITOR", 0, 0)]);
	composer.start();
	const settings = Settings.isolated();
	const keybindings = KeybindingsManager.inMemory();
	const sidePanel = new SidePanelController({ ui: composer.ui, composer, settings, keybindings });
	const ctx = {
		ui: composer.ui,
		handlesBtwBranchKey: () => false,
		editor: {
			getText: () => "",
			setActionKeys: () => {},
			setCustomKeyHandler: () => {},
			clearCustomKeyHandlers: () => {},
			spaceHold: new SpaceHoldGesture(() => {}),
		},
		keybindings,
		dictationSpaceHold: () => undefined,
		session: { extensionRunner: undefined },
		showStatus: () => {},
		setClickHoverId: () => {},
		sidePanel,
	} as unknown as InteractiveModeContext;
	new InputController(ctx).setupKeyHandlers();
	const settle = () => scheduler.settle(term);
	await settle();
	return { term, composer, settings, sidePanel, settle, stop: () => composer.stop() };
}

beforeAll(async () => {
	await initTheme();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("app.sidebar.toggle routing", () => {
	it("leaves alt+t to a focused inline tree selector", async () => {
		const h = await harness(120);
		try {
			const tree = new TreeSelectorComponent(
				[],
				null,
				24,
				() => {},
				() => {},
			);
			const received: string[] = [];
			const handle = tree.handleInput.bind(tree);
			tree.handleInput = (data: string) => {
				received.push(data);
				handle(data);
			};
			h.composer.ui.setFocus(tree);
			h.term.sendInput(ALT_T);
			await h.settle();
			expect(received).toEqual([ALT_T]);
			expect(cfgSidebarEnabled.get(h.settings)).toBe(false);
		} finally {
			h.stop();
		}
	});

	it("gives alt+t to a dialog stacked above the fullscreen panel", async () => {
		const h = await harness(100);
		try {
			h.term.sendInput(ALT_T);
			h.term.sendInput("t");
			await h.settle();
			expect(h.sidePanel.fullscreenOpen).toBe(true);

			const received: string[] = [];
			const dialog: Component = {
				render: () => ["dialog"],
				invalidate: () => {},
				handleInput: (data: string) => received.push(data),
			};
			h.composer.ui.showOverlay(dialog);
			await h.settle();
			h.term.sendInput(ALT_T);
			await h.settle();
			expect(received).toEqual([ALT_T]);
			expect(h.sidePanel.fullscreenOpen).toBe(true);

			// Once the dialog closes, the shown view's chord closes the panel again.
			h.composer.ui.hideOverlay();
			await h.settle();
			h.term.sendInput(ALT_T);
			h.term.sendInput("t");
			await h.settle();
			expect(h.sidePanel.fullscreenOpen).toBe(false);
		} finally {
			h.stop();
		}
	});
});

describe("alt+t view chords", () => {
	it("opens, switches and hides views on a wide terminal", async () => {
		const h = await harness(120);
		try {
			h.term.sendInput(ALT_T);
			h.term.sendInput("a");
			await h.settle();
			expect(cfgSidebarEnabled.get(h.settings)).toBe(true);
			expect(cfgSidebarView.get(h.settings)).toBe("agents");
			expect(h.sidePanel.dockedView).toBe("agents");

			h.term.sendInput(ALT_T);
			h.term.sendInput("i");
			await h.settle();
			expect(cfgSidebarEnabled.get(h.settings)).toBe(true);
			expect(h.sidePanel.dockedView).toBe("irc");

			// The shown view's chord hides the panel and keeps the view for next time.
			h.term.sendInput(ALT_T);
			h.term.sendInput("i");
			await h.settle();
			expect(cfgSidebarEnabled.get(h.settings)).toBe(false);
			expect(h.sidePanel.dockedView).toBeUndefined();
			expect(cfgSidebarView.get(h.settings)).toBe("irc");

			// Alt held through both keys reads the same as the bare view key.
			h.term.sendInput(ALT_T);
			h.term.sendInput(ALT_T);
			await h.settle();
			expect(h.sidePanel.dockedView).toBe("todo");
		} finally {
			h.stop();
		}
	});

	it("cancels on escape and lets any other key keep its meaning", async () => {
		const h = await harness(120);
		const typed: string[] = [];
		const editor: Component = {
			render: () => ["EDITOR"],
			invalidate: () => {},
			handleInput: (data: string) => typed.push(data),
		};
		h.composer.ui.setFocus(editor);
		try {
			h.term.sendInput(ALT_T);
			h.term.sendInput("\x1b");
			h.term.sendInput("t");
			await h.settle();
			expect(cfgSidebarEnabled.get(h.settings)).toBe(false);
			expect(typed).toEqual(["t"]);

			h.term.sendInput(ALT_T);
			h.term.sendInput("x");
			h.term.sendInput("a");
			await h.settle();
			expect(cfgSidebarEnabled.get(h.settings)).toBe(false);
			expect(typed).toEqual(["t", "x", "a"]);
		} finally {
			h.stop();
		}
	});

	it("lapses after the timeout", async () => {
		const h = await harness(120);
		const typed: string[] = [];
		const editor: Component = {
			render: () => ["EDITOR"],
			invalidate: () => {},
			handleInput: (data: string) => typed.push(data),
		};
		h.composer.ui.setFocus(editor);
		vi.useFakeTimers();
		try {
			h.term.sendInput(ALT_T);
			vi.advanceTimersByTime(2500);
			h.term.sendInput("t");
			expect(cfgSidebarEnabled.get(h.settings)).toBe(false);
			expect(typed).toEqual(["t"]);
		} finally {
			vi.useRealTimers();
			h.stop();
		}
	});
});
