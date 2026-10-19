import { describe, expect, it } from "bun:test";
import { SettingsFormField, SettingsList, type SettingsListTheme } from "../src/components/settings-list";
import { TextFormField } from "../src/components/form";

const settingsTheme: SettingsListTheme = {
	label: text => text,
	value: text => text,
	description: text => text,
	cursor: "> ",
	hint: text => text,
};
const fieldTheme = {
	label: (text: string) => text,
	description: (text: string) => text,
	error: (text: string) => text,
	hint: (text: string) => text,
};

describe("SettingsList host-decoded navigation", () => {
	it("clears a standalone g prefix before applying a host action", () => {
		const list = new SettingsList(
			Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}`, label: `Row ${i}`, currentValue: "" })),
			4,
			settingsTheme,
			() => {},
			() => {},
		);
		list.render(60);
		list.handleInput("g");
		list.handleNavigation({ kind: "move", delta: 1 });
		expect(list.getSelectedItem()?.id).toBe("row-1");
		list.handleInput("g");
		expect(list.getSelectedItem()?.id).toBe("row-1");
		list.handleInput("g");
		expect(list.getSelectedItem()?.id).toBe("row-0");
		list.handleNavigation({ kind: "boundary", edge: "last" });
		expect(list.getSelectedItem()?.id).toBe("row-11");
	});

	it("delegates SettingsFormField focus through its filter and a nested ordinary text field", () => {
		const field = new SettingsFormField({
			items: [
				{
					id: "name",
					label: "Name",
					currentValue: "active",
					submenu: (value, done) =>
						new TextFormField({
							theme: fieldTheme,
							initialValue: value,
							onSubmit: text => done(text),
							onCancel: () => done(),
						}),
				},
			],
			maxVisible: 4,
			settingsTheme,
			fieldTheme,
			onChange: () => {},
			onCancel: () => {},
		});
		expect(field.filterFocused).toBe(false);
		field.handleInput("/");
		expect(field.filterFocused).toBe(true);
		field.handleInput("jkgG/ ");
		expect(field.settingsList.getSearchQuery()).toBe("jkgG/ ");
		field.handleInput("\x1b");
		expect(field.filterFocused).toBe(false);
		field.settingsList.clearSearch();
		field.settingsList.handleNavigation({ kind: "confirm" });
		expect(field.settingsList.hasOpenSubmenu()).toBe(true);
		expect(field.filterFocused).toBe(true);
		field.handleInput(" jkgG/ ");
		expect(field.settingsList.navigationSnapshot()).toMatchObject({
			submenuId: "name",
			submenu: { value: "active jkgG/ " },
		});
	});
});
