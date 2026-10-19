import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bindEffects } from "@oh-my-pi/pi-coding-agent/config/registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgTerminalImageProtocol } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { getKittyGraphics, setKittyGraphics } from "@oh-my-pi/pi-tui/kitty-graphics";
import { isSixelPassthroughEnabled } from "@oh-my-pi/pi-tui/render/sixel";
import {
	ImageProtocol,
	isImageProtocolForced,
	setTerminalImageProtocol,
	setTerminalImageProtocolSetting,
	TERMINAL,
} from "@oh-my-pi/pi-tui/terminal-capabilities";

const ENV_KEYS = [
	"PI_FORCE_IMAGE_PROTOCOL",
	"PI_ALLOW_SIXEL_PASSTHROUGH",
	"TMUX",
	"PI_KITTY_PLACEHOLDERS",
	"PI_NO_KITTY_PLACEHOLDERS",
] as const;
let savedEnv: (string | undefined)[];
let savedProtocol: ImageProtocol | null;
let savedPlaceholders: boolean;
let release: (() => void) | undefined;

beforeEach(() => {
	savedEnv = ENV_KEYS.map(key => Bun.env[key]);
	savedProtocol = TERMINAL.imageProtocol;
	savedPlaceholders = getKittyGraphics().unicodePlaceholders;
});
afterEach(() => {
	release?.();
	release = undefined;
	for (const [index, key] of ENV_KEYS.entries()) {
		const value = savedEnv[index];
		if (value === undefined) delete Bun.env[key];
		else Bun.env[key] = value;
	}
	setTerminalImageProtocolSetting("auto");
	setTerminalImageProtocol(savedProtocol);
	setKittyGraphics({ unicodePlaceholders: savedPlaceholders });
});

describe("terminal.imageProtocol live setting", () => {
	it("overrides the environment, treats off as explicit, and restores the environment on auto", () => {
		Bun.env.PI_FORCE_IMAGE_PROTOCOL = "sixel";
		const settings = Settings.isolated({});
		release = bindEffects(settings);
		expect(TERMINAL.imageProtocol).toBe(ImageProtocol.Sixel);
		for (const [setting, protocol] of [
			["kitty", ImageProtocol.Kitty],
			["iterm2", ImageProtocol.Iterm2],
			["off", null],
		] as const) {
			cfgTerminalImageProtocol.set(settings, setting);
			expect(TERMINAL.imageProtocol).toBe(protocol);
			expect(isImageProtocolForced()).toBe(true);
		}
		cfgTerminalImageProtocol.set(settings, "auto");
		expect(TERMINAL.imageProtocol).toBe(ImageProtocol.Sixel);
		delete Bun.env.PI_FORCE_IMAGE_PROTOCOL;
		cfgTerminalImageProtocol.set(settings, "off");
		cfgTerminalImageProtocol.set(settings, "auto");
		expect(isImageProtocolForced()).toBe(false);
	});

	it("recomputes placeholder support and applies the explicit Sixel passthrough gate", () => {
		Bun.env.PI_FORCE_IMAGE_PROTOCOL = "off";
		Bun.env.TMUX = "/tmp/test-image-setting,1,0";
		delete Bun.env.PI_KITTY_PLACEHOLDERS;
		delete Bun.env.PI_NO_KITTY_PLACEHOLDERS;
		const settings = Settings.isolated({});
		release = bindEffects(settings);
		cfgTerminalImageProtocol.set(settings, "kitty");
		expect(getKittyGraphics().unicodePlaceholders).toBe(true);
		cfgTerminalImageProtocol.set(settings, "sixel");
		expect(getKittyGraphics().unicodePlaceholders).toBe(false);
		Bun.env.PI_ALLOW_SIXEL_PASSTHROUGH = "1";
		expect(isSixelPassthroughEnabled()).toBe(true);
		cfgTerminalImageProtocol.set(settings, "off");
		expect(isSixelPassthroughEnabled()).toBe(false);
		cfgTerminalImageProtocol.set(settings, "sixel");
		delete Bun.env.PI_ALLOW_SIXEL_PASSTHROUGH;
		expect(isSixelPassthroughEnabled()).toBe(false);
	});
});
