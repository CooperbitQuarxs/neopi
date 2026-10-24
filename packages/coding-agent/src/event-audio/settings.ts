import { register } from "../config/registry";

/** Enabling is session-local through /sounds; saved mappings never opt a session in. */
export const cfgEventAudioMappingPath = register({
	id: "eventAudio.mappingPath",
	type: "string",
	default: "~/.omp/sounds/trekcore/curation.json",
	ui: {
		tab: "interaction",
		group: "Speech",
		label: "Event sound mapping",
		description: "Owner-curated version-1 sound assignments. /sounds on enables this session; /sounds reload rereads it.",
	},
});

export const cfgEventAudioGain = register({
	id: "eventAudio.gain",
	type: "number",
	default: 0.35,
});
export const cfgEventAudioInterval = register({
	id: "eventAudio.minIntervalMs",
	type: "number",
	default: 250,
});
export const cfgEventAudioStreamInterval = register({
	id: "eventAudio.streamIntervalMs",
	type: "number",
	default: 1200,
});
