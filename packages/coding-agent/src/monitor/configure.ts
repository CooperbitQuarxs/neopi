import type { AnySetting } from "../config/registry";
import type { ExtensionUIContext } from "../extensibility/extensions/types";
import type { InteractiveModeContext } from "../modes/types";
import { MONITOR_SETTINGS } from "./settings";

const CUSTOM = "Custom…";

async function editSetting(ctx: InteractiveModeContext, ui: ExtensionUIContext, setting: AnySetting): Promise<void> {
	const metadata = setting.ui;
	if (!metadata) return;
	const current = setting.get(ctx.settings);
	if (setting.type === "boolean") {
		const selected = await ui.select(metadata.label, [
			{ label: "On", description: current === true ? "Current setting" : undefined },
			{ label: "Off", description: current === false ? "Current setting" : undefined },
		]);
		if (selected !== undefined) setting.set(ctx.settings, selected === "On");
		return;
	}
	if (setting.type === "enum") {
		const choices = metadata.options;
		if (!choices || choices === "runtime") return;
		const selected = await ui.select(
			`${metadata.label} · ${String(current)}`,
			choices.map(choice => ({ label: choice.label, description: choice.description })),
		);
		const choice = choices.find(choice => choice.label === selected);
		if (choice) setting.set(ctx.settings, choice.value);
		return;
	}
	const count = setting.id.endsWith("maxRows") || setting.id.endsWith("maxColumns");
	const sentinel = count ? "infinite" : "dynamic";
	const presets = count ? ["1", "2", "3", "4", "5", "8", "16", "32"] : ["10", "20", "30", "40", "80", "120"];
	const selected = await ui.select(`${metadata.label} · ${String(current)}`, [
		{
			label: sentinel,
			description: count ? "No count limit on this axis" : "Equalize sizes as panes are added",
		},
		...presets.map(value => ({ label: value, description: count ? `${value} maximum` : `${value} terminal cells` })),
		{ label: CUSTOM, description: `Type any positive safe integer or ${sentinel}` },
	]);
	if (selected === undefined) return;
	if (selected !== CUSTOM) {
		setting.set(ctx.settings, selected);
		return;
	}
	for (;;) {
		const value = await ui.input(`${metadata.label}: positive integer or ${sentinel}`, String(current));
		if (value === undefined) return;
		try {
			setting.set(ctx.settings, setting.parse(value));
			return;
		} catch (error) {
			ctx.showError(error instanceof Error ? error.message : String(error));
		}
	}
}

/** Reuse the standard Vim-capable selector/input dialogs; registry handles own persistence and validation. */
export async function configureAgentMonitor(ctx: InteractiveModeContext): Promise<void> {
	const ui = ctx.getToolUIContext();
	if (!ui) {
		ctx.showError(
			"Monitor configuration needs the interactive UI; the same controls are in /settings → Agent monitor.",
		);
		return;
	}
	for (;;) {
		const choices = MONITOR_SETTINGS.map(setting => ({
			label: `${setting.ui?.label ?? setting.id} · ${String(setting.get(ctx.settings))}`,
			description: setting.ui?.description,
		}));
		const selected = await ui.select("Agent monitor · restart to fully rearrange existing panes", choices);
		if (selected === undefined) return;
		const index = choices.findIndex(choice => choice.label === selected);
		if (index < 0) return;
		try {
			await editSetting(ctx, ui, MONITOR_SETTINGS[index]);
		} catch (error) {
			ctx.showError(error instanceof Error ? error.message : String(error));
		}
	}
}
