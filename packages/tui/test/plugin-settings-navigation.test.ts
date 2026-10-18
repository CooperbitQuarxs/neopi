import { beforeAll, expect, it } from "bun:test";
import { initTheme } from "../src/theme/theme";
import { PluginListComponent, PluginSettingsComponent, type InstalledPlugin, type PluginSettingsHost } from "../src/overlays/plugin-settings";

beforeAll(async () => { await initTheme(); });

const plugin: InstalledPlugin = { name: "hjkl", version: "1", enabled: true, enabledFeatures: null, manifest: { settings: { token: { type: "string", secret: true } } } };

it("routes literal plugin search before configure shortcuts and restores it", () => {
	const opened: string[] = [];
	const make = () => new PluginListComponent([{ kind: "npm", plugin }], { onNpmSelect: entry => { opened.push(entry.name); }, onMarketplaceSelect: () => {}, onCancel: () => {} });
	const list = make();
	list.handleInput("/");
	list.handleInput("hjkl");
	expect(opened).toEqual([]);
	list.handleInput("\x1b");
	const snapshot = list.navigationSnapshot();
	const restored = make();
	restored.restoreNavigation(snapshot);
	expect(restored.navigationSnapshot()).toEqual(snapshot);
	restored.handleInput("l");
	expect(opened).toEqual(["hjkl"]);
});

it("restores a pending plugin detail after the registry loads without a history visit", async () => {
	const listed = Promise.withResolvers<InstalledPlugin[]>();
	const mounted = Promise.withResolvers<void>();
	const host: PluginSettingsHost = {
		manager: { list: () => listed.promise, getPlugin: async () => plugin, getPluginSettings: async () => ({}), setEnabled: async () => {}, getEnabledFeatures: async () => null, setEnabledFeatures: async () => {}, setPluginSetting: async () => {} },
		createMarketplaceManager: async () => ({ listInstalledPlugins: async () => [], setPluginEnabled: async () => {} }),
		parsePluginId: id => ({ name: id }),
	};
	const visits: string[] = [];
	let closed = false;
	const panel = new PluginSettingsComponent(host, { onClose: () => { closed = true; }, onPluginChanged: () => {}, requestRender: () => { mounted.resolve(); } });
	panel.onNavigationVisit = page => { visits.push(page); };
	panel.restoreNavigation({ view: "npm-detail", plugin: "hjkl", content: undefined });
	listed.resolve([plugin]);
	await mounted.promise;
	expect(panel.navigationSnapshot()).toMatchObject({ view: "npm-detail", plugin: "hjkl" });
	expect(visits).toEqual([]);
	panel.handleInput("\x1b");
	expect(panel.navigationSnapshot()).toMatchObject({ view: "list" });
	expect(closed).toBe(false);
	panel.handleInput("\x1b");
	expect(closed).toBe(true);
});
