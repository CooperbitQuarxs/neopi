import { isRecord } from "@oh-my-pi/pi-utils";
import { lookup, register } from "./registry";

/** Dotted registered setting ids. Missing entries inherit the ordinary settings layers. */
export type RoleSettings = Record<string, Record<string, unknown>>;

export const cfgRoleSettings = register({
	id: "roleSettings",
	type: "record",
	default: {} as RoleSettings,
	validate: raw => {
		if (raw === undefined || raw === null) return;
		if (!isRecord(raw)) throw new Error("roleSettings must be a map of role names to settings");
		for (const [role, entries] of Object.entries(raw)) {
			if (!role.trim() || !isRecord(entries)) throw new Error(`Invalid roleSettings entry for "${role}"`);
			for (const [id, value] of Object.entries(entries)) {
				const setting = lookup(id);
				if (!setting?.roleScoped) throw new Error(`Setting "${id}" does not support role overrides`);
				// null masks a lower-priority role entry and restores inheritance.
				if (value !== null) setting.assertRoleWritable(value);
			}
		}
	},
});
