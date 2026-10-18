import { describe, expect, it } from "bun:test";
import { SelectorController, type MenuKind } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { SettingsList, type SettingsListTheme } from "@oh-my-pi/pi-tui/components/settings-list";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@oh-my-pi/pi-tui";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

const theme: SettingsListTheme = {
	label: text => text,
	value: text => text,
	description: text => text,
	cursor: ">",
	hint: text => text,
};

function harness() {
	const overlayStack: TUI["overlayStack"] = [];
	let focused: Component | null = null;
	const status: string[] = [];
	const shown: Component[] = [];
	const showOverlay = (component: Component, options?: OverlayOptions): OverlayHandle => {
		const entry = { component, options, preFocus: focused, hidden: false, released: false };
		overlayStack.push(entry);
		shown.push(component);
		focused = component;
		return {
			hide: () => {
				const at = overlayStack.indexOf(entry);
				if (at >= 0) overlayStack.splice(at, 1);
				focused = entry.preFocus;
			},
			setHidden: hidden => { entry.hidden = hidden; },
			isHidden: () => entry.hidden,
		};
	};
	const ctx = createInteractiveModeContext({
		ui: {
			overlayStack,
			showOverlay,
			getFocused: () => focused,
			setFocus: component => { focused = component; },
		},
		showStatus: message => { status.push(message); },
	});
	const controller = new SelectorController(ctx);
	const menus = new Map<MenuKind, SettingsList>();
	const closes = new Map<MenuKind, () => void>();
	const open = (kind: MenuKind) => {
		const host = controller.openMenu(kind, () => open(kind));
		if (!host) return;
		let handle: OverlayHandle;
		const close = () => {
			host.close();
			handle.hide();
			controller.focusActiveEditorArea();
		};
		const list = new SettingsList([
			{ id: "first", label: "First", currentValue: "off", values: ["off", "on"] },
			{ id: "nested", label: "Nested", currentValue: "", submenu: (_value, done) => new SettingsList([
				{ id: "a", label: "Alpha", currentValue: "off", values: ["off", "on"] },
				{ id: "b", label: "Beta", currentValue: "off", values: ["off", "on"] },
			], 4, theme, () => {}, () => done()) },
		], 4, theme, () => {}, close);
		menus.set(kind, list);
		closes.set(kind, close);
		host.mount(list, () => { handle = showOverlay(list); return handle; });
	};
	return { controller, ctx, open, menus, closes, shown, status, overlayStack, showOverlay, focused: () => focused };
}

describe("controller menu timeline", () => {
	it("restores a nested page in place and preserves both parent and child selection", () => {
		const h = harness();
		h.open("settings");
		const menu = h.menus.get("settings")!;
		menu.handleInput("j");
		menu.handleInput("\r");
		menu.handleInput("j");
		expect(menu.navigationSnapshot().submenuId).toBe("nested");
		expect(h.controller.navigateMenuHistory(-1)).toBe(true);
		expect(h.shown).toHaveLength(1);
		expect(menu.navigationSnapshot().submenuId).toBeNull();
		expect(menu.getSelectedItem()?.id).toBe("nested");
		expect(h.controller.navigateMenuHistory(1)).toBe(true);
		expect(h.shown).toHaveLength(1);
		expect(menu.navigationSnapshot().submenuId).toBe("nested");
		const child = menu.openSubmenu?.component;
		expect(child).toBeInstanceOf(SettingsList);
		expect((child as SettingsList).getSelectedItem()?.id).toBe("b");
	});

	it("records a nested close as conversation and reopens that nested page", async () => {
		const h = harness();
		h.open("settings");
		const original = h.menus.get("settings")!;
		original.handleInput("j");
		original.handleInput("\r");
		original.handleInput("j");
		h.closes.get("settings")!();
		await Promise.resolve();
		expect(h.overlayStack).toHaveLength(0);
		expect(h.controller.navigateMenuHistory(-1)).toBe(true);
		const reopened = h.menus.get("settings")!;
		expect(reopened).not.toBe(original);
		expect(reopened.navigationSnapshot().submenuId).toBe("nested");
		expect((reopened.openSubmenu?.component as SettingsList).getSelectedItem()?.id).toBe("b");
		expect(h.controller.navigateMenuHistory(1)).toBe(true);
		expect(h.overlayStack).toHaveLength(0);
		expect(h.focused()).toBe(h.ctx.editorContainer.children[0] ?? h.ctx.editor);
	});

	it("preserves forward visits when C is opened from the older A visit", () => {
		const h = harness();
		h.open("settings"); // A
		h.menus.get("settings")!.handleInput("j");
		h.open("advisor-config"); // B
		expect(h.controller.navigateMenuHistory(-1)).toBe(true); // A
		h.open("chain-config"); // C, appended after B
		expect(h.controller.navigateMenuHistory(-1)).toBe(true); // origin A
		expect(h.focused()).toBe(h.menus.get("settings")!);
		expect(h.menus.get("settings")!.getSelectedItem()?.id).toBe("nested");
		expect(h.controller.navigateMenuHistory(1)).toBe(true); // B retained
		expect(h.focused()).toBe(h.menus.get("advisor-config")!);
		expect(h.controller.navigateMenuHistory(1)).toBe(true); // C
		expect(h.focused()).toBe(h.menus.get("chain-config")!);
	});

	it("keeps an unregistered blocking overlay mounted without changing history", () => {
		const h = harness();
		h.open("settings");
		const prompt = new SettingsList([], 4, theme, () => {}, () => {});
		h.showOverlay(prompt);
		expect(h.controller.navigateMenuHistory(-1)).toBe(true);
		expect(h.focused()).toBe(prompt);
		expect(h.overlayStack).toHaveLength(2);
		expect(h.status).toEqual(["Finish or cancel the prompt first"]);
	});
});
