import { beforeAll, describe, expect, it } from "bun:test";
import { PluginSelectorComponent } from "../src/overlays/plugin-selector";
import { initTheme } from "../src/theme/theme";

beforeAll(async () => { await initTheme(false); });

function make(mode: "install" | "uninstall") {
	const selected: string[] = [];
	const selector = new PluginSelectorComponent(mode, 1, [
		{ plugin: { name: "alpha", description: "First plugin" }, marketplace: "shop", scope: "user" },
	], new Set(), { onSelect: name => selected.push(name), onCancel: () => {} });
	return { selector, list: selector.getSelectList(), selected };
}

describe("plugin picker activation policy", () => {
	it("never uninstalls on normal Space, including when the child list owns focus", () => {
		const { list, selected } = make("uninstall");
		list.handleInput(" ");
		expect(selected).toEqual([]);
		list.handleInput("\r");
		expect(selected).toEqual(["alpha"]);
	});

	it("keeps Space literal in an uninstall filter", () => {
		const { list, selected } = make("uninstall");
		list.handleInput("/");
		for (const char of "alpha ") list.handleInput(char);
		expect(list.navigationState().filter).toBe("alpha ");
		expect(selected).toEqual([]);
		list.handleInput("\x1b");
		list.handleInput(" ");
		expect(selected).toEqual([]);
	});

	it("retains nondestructive Space selection for installation", () => {
		const { list, selected } = make("install");
		list.handleInput(" ");
		expect(selected).toEqual(["alpha"]);
	});

	it("names native uninstall explicitly and still requires confirmation", () => {
		const { selector, selected } = make("uninstall");
		const root = selector.describe({ cols: 100, dark: true, reduceMotion: false, supports: () => true, feature: () => true });
		expect(root?.c?.[0]).toMatchObject({ k: "picker", p: { actions: [{ label: "Uninstall" }, { label: "Close" }] } });
		selector.handleNativeEvent({ type: "action", key: "^picker", act: "confirm", mods: [] });
		expect(selected).toEqual(["alpha"]);
	});
});
