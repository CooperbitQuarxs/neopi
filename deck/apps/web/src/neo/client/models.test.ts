import { afterEach, expect, test } from "bun:test";
import { hiddenProviderIds, models, splitPick, visibleModels } from "./models";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("native effort suffixes leave opaque provider and role selectors intact", () => {
	expect(splitPick("@review:xhigh", ["high", "xhigh"])).toEqual({ selector: "@review", effort: "xhigh" });
	expect(splitPick("local/model:revision", ["high"])).toEqual({ selector: "local/model:revision", effort: "" });
	expect(splitPick("openrouter/org/model:revision:high", ["high"])).toEqual({ selector: "openrouter/org/model:revision", effort: "high" });
});

test("hidden providers filter both model rows and policies resolved through them", () => {
	const hidden = hiddenProviderIds([{ id: "codex", hidden: true }, { id: "zai", hidden: true }, { id: "anthropic", hidden: false }]);
	const rows = [
		{ selector: "@review", provider: "openai-codex" },
		{ selector: "openai-codex/sol", provider: "openai-codex" },
		{ selector: "zai-coding-plan/glm", provider: "zai-coding-plan" },
		{ selector: "anthropic/opus", provider: "anthropic" },
	];
	expect(visibleModels(rows, hidden).map(row => row.selector)).toEqual(["anthropic/opus"]);
	expect(visibleModels(rows, hiddenProviderIds([]))).toEqual(rows);
});

test("live role catalog keeps policy identity separate from its current resolution", async () => {
	const urls: string[] = [];
	globalThis.fetch = (async input => {
		const url = String(input); urls.push(url);
		return Response.json(url.includes("model-roles") ? {
			roles: [{ id: "review", name: "Review", section: "chat", hidden: false, resolved: { provider: "codex", modelId: "sol" }, effectiveValue: "codex/sol:high" }],
			thinkingLevels: ["off", "high"],
		} : { models: [{ provider: "codex", id: "sol", label: "Sol", contextWindow: 200000, isAvailable: true }] });
	}) as typeof fetch;
	const catalog = await models.catalog({ sessionId: "session/a", cwd: "/workspace two" });
	expect(catalog.items[0]).toMatchObject({ selector: "@review", resolvedSelector: "codex/sol", role: true });
	expect(catalog.items[0]!.facts.intelligence).toBeNull();
	expect(catalog.items[1]!.facts.effectiveContextWindow).toBeNull();
	expect(catalog.items[1]!.facts.contextWindow).toBe(200000);
	expect(urls.every(url => url.includes("sessionId=session%2Fa") && url.includes("cwd=%2Fworkspace+two"))).toBe(true);
});

test("role discovery failure stays visible without hiding the live model catalog", async () => {
	globalThis.fetch = (async input => String(input).includes("model-roles")
		? Response.json({ error: "Role capability unavailable" }, { status: 501 })
		: Response.json({ models: [{ provider: "local", id: "chat", isAvailable: true }] })) as typeof fetch;
	const catalog = await models.catalog();
	expect(catalog.roleError).toBe("Role capability unavailable");
	expect(catalog.items.map(item => item.selector)).toEqual(["local/chat"]);
});

test("fallback selection uses NeoPi's chat pool instead of offering speech models", async () => {
	globalThis.fetch = (async input => Response.json(String(input).includes("model-roles") ? {
		roles: [{ id: "default", name: "Default", section: "chat", hidden: false, pool: 0 }],
		pools: [{ models: ["local/chat"], mixtures: false }], thinkingLevels: [],
	} : { models: [{ provider: "local", id: "chat", isAvailable: true }, { provider: "local", id: "speech", isAvailable: true }] })) as typeof fetch;
	const catalog = await models.catalog();
	expect(catalog.items.filter(item => !item.role && item.available).map(item => item.selector)).toEqual(["local/chat"]);
});
