import type { Model } from "@oh-my-pi/pi-ai";
import { isRecord } from "@oh-my-pi/pi-utils";
import type { AnySetting } from "../config/registry";
import type { Settings } from "../config/settings";
import {
	cfgCompactionAgentControl,
	cfgCompactionAsyncEnabled,
	cfgCompactionAutoContinue,
	cfgCompactionEnabled,
	cfgCompactionKeepRecentTokens,
	cfgCompactionMethodOrder,
	cfgCompactionMidTurnEnabled,
	cfgCompactionReserveTokens,
	cfgCompactionThresholdPercent,
	cfgCompactionThresholdTokens,
} from "./context-settings";
import { sessionCompactionControlKeys as sessionKeys } from "./compaction-control-state";
import { isCompactionMethod } from "./compaction-methods";
import { getSessionCompactionBoundaries } from "./context-usage-runtime";
import { resolveModelCompactionSettings } from "./model-compaction-threshold";

const controls = {
	enabled: cfgCompactionEnabled,
	thresholdPercent: cfgCompactionThresholdPercent,
	thresholdTokens: cfgCompactionThresholdTokens,
	reserveTokens: cfgCompactionReserveTokens,
	methodOrder: cfgCompactionMethodOrder,
	asyncEnabled: cfgCompactionAsyncEnabled,
	midTurnEnabled: cfgCompactionMidTurnEnabled,
	keepRecentTokens: cfgCompactionKeepRecentTokens,
	autoContinue: cfgCompactionAutoContinue,
} satisfies Record<string, AnySetting>;

type ControlKey = keyof typeof controls;
type ControlScope = "session" | "project" | "user";
export interface CompactionControlRequest {
	action: "show" | "propose" | "set" | "reset";
	scope: ControlScope;
	values?: Partial<Record<ControlKey, unknown>>;
	keys?: ControlKey[];
}

export function clearSessionCompactionControls(settings: Settings): void {
	const keys = sessionKeys.get(settings);
	if (!keys) return;
	for (const key of keys) if (controlKey(key)) controls[key].clearOverride(settings);
	sessionKeys.delete(settings);
}

function controlKey(key: string): key is ControlKey {
	return Object.hasOwn(controls, key);
}

/** JSON is shared verbatim by `/compact control` and `compaction://`. */
export function parseCompactionControlRequest(input: unknown): CompactionControlRequest {
	if (!isRecord(input)) throw new Error("Compaction control expects a JSON object.");
	for (const key of Object.keys(input)) {
		if (!["action", "scope", "values", "keys"].includes(key)) throw new Error(`Unknown control field: ${key}`);
	}
	const action = input.action ?? "show";
	if (action !== "show" && action !== "propose" && action !== "set" && action !== "reset") {
		throw new Error("action must be show, propose, set, or reset.");
	}
	const scope = input.scope ?? "session";
	if (scope !== "session" && scope !== "project" && scope !== "user") {
		throw new Error("scope must be session, project, or user.");
	}
	const request: CompactionControlRequest = { action, scope };
	if (action === "set" || action === "propose") {
		if (!isRecord(input.values) || Object.keys(input.values).length === 0) {
			throw new Error("set/propose requires a non-empty values object.");
		}
		if (input.keys !== undefined) throw new Error("keys is only accepted by reset.");
		const values: Partial<Record<ControlKey, unknown>> = {};
		for (const [key, value] of Object.entries(input.values)) {
			if (!controlKey(key)) throw new Error(`Unknown compaction control: ${key}`);
			controls[key].assertWritable(value);
			if (
				key === "thresholdPercent" &&
				!(typeof value === "number" && (value === -1 || (value >= 1 && value <= 99)))
			) {
				throw new Error("thresholdPercent must be -1 or between 1 and 99.");
			}
			if (["thresholdTokens", "reserveTokens", "keepRecentTokens"].includes(key)) {
				if (
					typeof value !== "number" ||
					!Number.isSafeInteger(value) ||
					(key === "thresholdTokens" ? value !== -1 && value <= 0 : value < 0)
				) {
					throw new Error(
						`${key} must be a non-negative safe integer${key === "thresholdTokens" ? " greater than zero, or -1" : ""}.`,
					);
				}
			}
			if (key === "methodOrder") {
				if (
					!Array.isArray(value) ||
					value.some(method => !isCompactionMethod(method)) ||
					new Set(value).size !== value.length
				) {
					throw new Error("methodOrder must contain distinct supported compaction methods.");
				}
			}
			values[key] = structuredClone(value);
		}
		// Selecting one threshold clears the competing threshold in the same scope.
		if (Object.hasOwn(values, "thresholdPercent") && !Object.hasOwn(values, "thresholdTokens"))
			values.thresholdTokens = -1;
		if (Object.hasOwn(values, "thresholdTokens") && !Object.hasOwn(values, "thresholdPercent"))
			values.thresholdPercent = -1;
		request.values = values;
	} else {
		if (input.values !== undefined) throw new Error("values is only accepted by set/propose.");
		if (input.keys !== undefined) {
			if (
				action !== "reset" ||
				!Array.isArray(input.keys) ||
				!input.keys.every(key => typeof key === "string" && controlKey(key))
			) {
				throw new Error("reset keys must name supported compaction controls.");
			}
			request.keys = input.keys as ControlKey[];
			if (request.keys.some(key => key === "thresholdTokens" || key === "thresholdPercent")) {
				request.keys = [...new Set([...request.keys, "thresholdTokens" as const, "thresholdPercent" as const])];
			}
		}
	}
	return request;
}

export async function runCompactionControl(
	settings: Settings,
	input: unknown,
	options: { agent?: boolean; model?: Model | null; tokens?: number } = {},
): Promise<string> {
	const request = parseCompactionControlRequest(input);
	const policy = cfgCompactionAgentControl.get(settings);
	if (options.agent && request.action !== "show") {
		if (policy === "read-only" || (request.action !== "propose" && policy !== "write")) {
			throw new Error(`Agent compaction policy is ${policy}; no settings changed.`);
		}
	}
	if (request.action === "set" || request.action === "reset") {
		const keys =
			request.action === "set"
				? (Object.keys(request.values!) as ControlKey[])
				: (request.keys ?? (Object.keys(controls) as ControlKey[]));
		for (const key of keys) {
			const setting: AnySetting = controls[key];
			const value = request.values?.[key];
			if (request.scope === "session") {
				if (request.action === "reset") {
					setting.clearOverride(settings);
					sessionKeys.get(settings)?.delete(key);
				} else {
					settings.writeValue(setting, value, "override");
					let tracked = sessionKeys.get(settings);
					if (!tracked) sessionKeys.set(settings, (tracked = new Set()));
					tracked.add(key);
				}
			} else {
				if (request.scope === "project")
					settings.writeProjectValue(setting, request.action === "reset" ? undefined : value);
				else if (request.action === "reset") setting.unset(settings);
				else settings.writeValue(setting, value, "global");
			}
		}
		if (request.scope !== "session") await settings.flush();
	}
	const resolved = resolveModelCompactionSettings(settings, options.model);
	const window = options.model?.contextWindow;
	return JSON.stringify(
		{
			action: request.action,
			scope: request.scope,
			agentPolicy: policy,
			...(request.action === "propose" ? { proposal: request.values, applied: false } : {}),
			resolved: Object.fromEntries(Object.keys(controls).map(key => [key, resolved[key as ControlKey]])),
			sources: Object.fromEntries(
				Object.entries(controls).map(([key, setting]) => [key, setting.provenance(settings)]),
			),
			contextWindow: window ?? null,
			currentTokens: options.tokens ?? null,
			boundaries: window ? getSessionCompactionBoundaries(settings, window, options.model) : null,
		},
		null,
		2,
	);
}
