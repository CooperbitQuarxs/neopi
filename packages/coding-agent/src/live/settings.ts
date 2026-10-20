/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";
import { DEFAULT_LIVE_MODEL } from "./protocol";
import { DEFAULT_LIVE_VOICE, LIVE_VOICE_OPTIONS, LIVE_VOICE_VALUES } from "./voices";

export const cfgLiveModel = register({
	id: "live.model",
	type: "string",
	default: DEFAULT_LIVE_MODEL,
	validate: value => {
		if (value === undefined) return;
		if (typeof value !== "string" || !value || /\s/.test(value)) {
			throw new Error("Live model must be a nonempty model slug without whitespace");
		}
	},
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Model",
		description: "Codex realtime model slug; applies to the next live call",
	},
});

export const cfgLiveVoice = register({
	id: "live.voice",
	type: "enum",
	values: LIVE_VOICE_VALUES,
	default: DEFAULT_LIVE_VOICE,
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Voice",
		description: "Voice used by Codex-backed realtime voice sessions",
		options: LIVE_VOICE_OPTIONS,
	},
});

export const cfgLiveModelCatalogPath = register({
	id: "live.modelCatalogPath",
	type: "string",
	default: "~/.bnuuy-agents/skills/model-catalog/catalog.json",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Model Catalog",
		description: "Path to the operator-editable model catalog JSON used for effort alerts.",
	},
});

export const cfgLiveDelegationDelivery = register({
	id: "live.delegationDelivery",
	type: "enum",
	values: ["steer", "followUp", "interrupt"],
	default: "steer",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Handoff Delivery",
		description: "How vocal handoffs reach the main agent; applies to the next handoff without restarting live mode",
		options: [
			{ value: "steer", label: "Steer without cancelling (default)" },
			{ value: "followUp", label: "Queue for next yield" },
			{ value: "interrupt", label: "Interrupt and restart" },
		],
	},
});

export const cfgLiveSuppressDelegateKeyword = register({
	id: "live.suppressDelegateKeyword",
	type: "string",
	default: "Iris",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Direct-Address Keyword",
		description:
			"Leading address that rejects handoffs to the main agent; case/punctuation insensitive (empty disables)",
	},
});

export const cfgLiveForceUtteranceKeyword = register({
	id: "live.forceUtteranceKeyword",
	type: "string",
	default: "relay",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Force-Utterance Keyword",
		description:
			"Phrase anywhere in finalized speech that requires a canonical main-agent handoff; direct address wins (empty disables)",
	},
});

export const cfgLiveHoldMode = register({
	id: "live.holdMode",
	type: "boolean",
	default: false,
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Hold Mode",
		description:
			"Keep the floor until a trailing submit or force-delegate phrase sends the composer to the main agent",
	},
});

export const cfgLiveQuietFloorMs = register({
	id: "live.quietFloorMs",
	type: "number",
	default: 0,
	validate: value => {
		if (typeof value === "number" && value < 0) throw new Error("Live quiet floor must not be negative");
	},
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Quiet Floor (ms)",
		description: "Minimum quiet after every composer write before voice responses or delegation; 0 disables",
		options: [
			{ value: "0", label: "Disabled (default)" },
			{ value: "2000", label: "2000 ms" },
			{ value: "5000", label: "5000 ms" },
			{ value: "10000", label: "10000 ms" },
		],
	},
});
export const cfgLiveForceDelegateKeyword = register({
	id: "live.forceDelegateKeyword",
	type: "string",
	default: "",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Force-Delegate Keyword",
		description:
			"Phrase at the end of composer text that force-delegates after the configured silence (empty disables)",
	},
});

export const cfgLiveBlockDelegateKeyword = register({
	id: "live.blockDelegateKeyword",
	type: "string",
	default: "",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Block-Delegate Keyword",
		description: "Finalized speech containing this phrase stays with the voice agent (empty disables)",
	},
});

export const cfgLiveSubmitKeyword = register({
	id: "live.submitKeyword",
	type: "string",
	default: "",
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Submit Keyword",
		description: "Phrase at the end of composer text that submits after the configured silence (empty disables)",
	},
});

export const cfgLiveSubmitSilenceMs = register({
	id: "live.submitSilenceMs",
	type: "number",
	default: 2000,
	validate: value => {
		if (typeof value === "number" && value < 0) throw new Error("Live submit silence must not be negative");
	},
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Submit Silence (ms)",
		description: "Silence after the last composer write before a trailing submit or force-delegate keyword runs",
		options: [
			{ value: "0", label: "Immediately" },
			{ value: "500", label: "500 ms" },
			{ value: "1000", label: "1000 ms" },
			{ value: "2000", label: "2000 ms (default)" },
			{ value: "3000", label: "3000 ms" },
			{ value: "5000", label: "5000 ms" },
			{ value: "10000", label: "10000 ms" },
		],
	},
});
