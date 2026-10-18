import { afterEach, describe, expect, it } from "bun:test";
import { KEYBINDINGS } from "@oh-my-pi/pi-tui/app-keybindings";
import { KeybindingsManager } from "@oh-my-pi/pi-tui/keybindings";
import { setKittyProtocolActive } from "@oh-my-pi/pi-tui/keys";

describe("menu history default keys", () => {
	afterEach(() => setKittyProtocolActive(false));

	it("keeps legacy Tab out of history forward and offers Alt+O there", () => {
		const keybindings = new KeybindingsManager(KEYBINDINGS);
		// Legacy encoding: Tab and Ctrl+I are both 0x09, which stays Tab.
		expect(keybindings.matches("\t", "app.navigation.forward")).toBe(false);
		expect(keybindings.matches("\t", "tui.select.nextContext")).toBe(true);
		expect(keybindings.matches("\x1bo", "app.navigation.forward")).toBe(true);
		expect(keybindings.matches("\x0f", "app.navigation.back")).toBe(true);
		expect(keybindings.matches("\x0f", "app.tools.expand")).toBe(false);
		expect(keybindings.matches("\x1be", "app.tools.expand")).toBe(true);
	});

	it("reads a disambiguated Ctrl+I as history forward and Tab as context switch", () => {
		setKittyProtocolActive(true);
		const keybindings = new KeybindingsManager(KEYBINDINGS);
		expect(keybindings.matches("\x1b[105;5u", "app.navigation.forward")).toBe(true);
		expect(keybindings.matches("\x1b[105;5u", "tui.select.nextContext")).toBe(false);
		expect(keybindings.matches("\x1b[9u", "app.navigation.forward")).toBe(false);
		expect(keybindings.matches("\x1b[9u", "tui.select.nextContext")).toBe(true);
	});

	it("lets a user binding keep Ctrl+O on tools expand", () => {
		const keybindings = new KeybindingsManager(KEYBINDINGS, { "app.tools.expand": "ctrl+o" });
		expect(keybindings.matches("\x0f", "app.tools.expand")).toBe(true);
	});
});
