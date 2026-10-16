/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 *
 * Every key here is operator observability. Agent authorization (who may message or
 * overhear whom) stays addressed-only and has no settings.
 */
import { effect, register } from "../config/registry";
import { DEFAULT_IRC_HISTORY_MAX_ENTRIES, setIrcHistoryMaxEntries, setIrcRelayToMainTranscript } from "./policy";

export const cfgIrcViewerEnabled = register({
	id: "irc.operator.viewerEnabled",
	type: "boolean",
	default: true,
	ui: {
		tab: "tasks",
		group: "Messaging",
		label: "IRC Viewer",
		description: "Let the IRC viewer key open the history of agent-to-agent messages in this session",
	},
});

export const cfgIrcRelayToMainTranscript = register({
	id: "irc.operator.relayToMainTranscript",
	type: "boolean",
	default: true,
	ui: {
		tab: "tasks",
		group: "Messaging",
		label: "IRC Cards in Transcript",
		description:
			"Show agent-to-agent messages as short-lived cards in the main transcript. The IRC viewer keeps them either way",
	},
});
effect(cfgIrcRelayToMainTranscript, setIrcRelayToMainTranscript);

export const cfgIrcHistoryMaxEntries = register({
	id: "irc.history.maxEntries",
	type: "number",
	default: DEFAULT_IRC_HISTORY_MAX_ENTRIES,
	ui: {
		tab: "tasks",
		group: "Messaging",
		label: "IRC History Size",
		description: "Most messages the IRC viewer keeps per process; the oldest drop first",
		options: [
			{ value: "200", label: "200" },
			{ value: "1000", label: "1000" },
			{ value: "5000", label: "5000" },
		],
	},
});
effect(cfgIrcHistoryMaxEntries, setIrcHistoryMaxEntries);
