/** Voices accepted by Codex-backed realtime sessions and exposed in settings. */
export const LIVE_VOICE_OPTIONS = [
	{ value: "arbor", label: "Arbor" },
	{ value: "aube", label: "Aube" },
	{ value: "breeze", label: "Breeze" },
	{ value: "bubbie", label: "Bubbie" },
	{ value: "cove", label: "Cove" },
	{ value: "ember", label: "Ember" },
	{ value: "haetsal", label: "Haetsal" },
	{ value: "hanul", label: "Hanul" },
	{ value: "himari", label: "Himari" },
	{ value: "juniper", label: "Juniper" },
	{ value: "leher", label: "Leher" },
	{ value: "maple", label: "Maple" },
	{ value: "miko", label: "Miko" },
	{ value: "neer", label: "Neer" },
	{ value: "rindo", label: "Rindo" },
	{ value: "rio", label: "Rio" },
	{ value: "rivage", label: "Rivage" },
	{ value: "sol", label: "Sol" },
	{ value: "sonna", label: "Sonna" },
	{ value: "spruce", label: "Spruce" },
	{ value: "tinta", label: "Tinta" },
	{ value: "vale", label: "Vale" },
	{ value: "viola", label: "Viola" },
] as const;

/** Accepted values for the live voice setting. */
export const LIVE_VOICE_VALUES = LIVE_VOICE_OPTIONS.map(({ value }) => value);

/** Voice used when no live voice preference is configured. */
export const DEFAULT_LIVE_VOICE = "sol";
