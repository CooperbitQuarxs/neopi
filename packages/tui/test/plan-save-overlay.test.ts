import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { getKeybindings, setKeybindings } from "../src/keybindings";
import { KeybindingsManager } from "../src/app-keybindings";
import { PlanSaveOverlay, type PlanSaveOverlayResult } from "../src/overlays/plan-save-overlay";
import { initTheme } from "../src/theme";

let previous: KeybindingsManager;
beforeAll(async () => {
	await initTheme(false);
});
beforeEach(() => {
	previous = getKeybindings() as KeybindingsManager;
	setKeybindings(KeybindingsManager.inMemory());
});
afterEach(() => {
	setKeybindings(previous);
});

test("path input keeps menu letters, slash and Space literal even with a printable submit binding", () => {
	setKeybindings(KeybindingsManager.inMemory({ "tui.input.submit": "j" }));
	const results: (PlanSaveOverlayResult | undefined)[] = [];
	const overlay = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	for (const char of "j/k h l g G /plan.md") overlay.handleInput(char);
	expect(results).toEqual([]);
	overlay.handleInput("\x01");
	overlay.handleInput("X");
	overlay.handleNativeEvent({ type: "action", key: "", act: "save", mods: [] });
	expect(results).toEqual([{ path: "Xj/k h l g G /plan.md" }]);
});

test("Space never saves and explicit submit retains the suggested-path fallback", () => {
	const results: (PlanSaveOverlayResult | undefined)[] = [];
	const overlay = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	overlay.handleInput(" ");
	expect(results).toEqual([]);
	overlay.handleInput("\r");
	expect(results).toEqual([{ path: "/tmp/default.md" }]);
});

test("Escape cancels the one-shot path prompt without adding menu navigation", () => {
	const results: (PlanSaveOverlayResult | undefined)[] = [];
	const overlay = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	overlay.handleInput("draft");
	overlay.handleInput("\x1b");
	expect(results).toEqual([undefined]);
});

test("typed words remain one undo unit rather than one paste per character", () => {
	setKeybindings(KeybindingsManager.inMemory({ "tui.editor.undo": "ctrl+z" }));
	const results: (PlanSaveOverlayResult | undefined)[] = [];
	const overlay = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	for (const char of "draft.md") overlay.handleInput(char);
	overlay.handleInput("\x1a");
	overlay.handleInput("\r");
	expect(results).toEqual([{ path: "/tmp/default.md" }]);
});

test("literal binding overrides do not remove explicit Enter and Escape exits", () => {
	setKeybindings(KeybindingsManager.inMemory({ "tui.input.submit": "j", "tui.select.cancel": "k" }));
	const results: (PlanSaveOverlayResult | undefined)[] = [];
	const first = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	first.handleInput("jk");
	first.handleInput("\r");
	const second = new PlanSaveOverlay("/tmp/default.md", result => results.push(result));
	second.handleInput("kj");
	second.handleInput("\x1b");
	expect(results).toEqual([{ path: "jk" }, undefined]);
});
