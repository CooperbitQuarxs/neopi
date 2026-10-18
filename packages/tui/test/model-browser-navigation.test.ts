import { beforeAll, expect, test } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { buildBrowserItems, ModelBrowser, type ModelBrowserSource } from "../src/overlays/model-browser";
import { initTheme } from "../src/theme";

const source: ModelBrowserSource = {
	revision: 0,
	defaultThinkingLevel: "high",
	modelProviderOrder: [],
	knownRoleIds: [],
	mruOrder: [],
	modelPerf: new Map(),
	getModelRole: () => undefined,
	getRoleInfo: role => ({ name: role, section: "chat", accepts: () => true }),
	defaultRoleChain: () => [],
	resolveRoleValue: () => ({ model: undefined, explicitThinkingLevel: false }),
};

function browser(): ModelBrowser {
	const result = new ModelBrowser(source);
	result.setMaxVisible(6);
	result.setItems(buildBrowserItems(Array.from({ length: 30 }, (_, index) => buildModel({
		id: `model-${String(index).padStart(2, "0")}`,
		name: `Model ${index}`,
		provider: "test",
		api: "ollama-chat",
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 1024,
	}))));
	return result;
}

beforeAll(async () => { await initTheme(false); });

test("model browser starts in navigation and slash alone focuses literal search", () => {
	const menu = browser();
	menu.handleInput("i");
	expect(menu.query).toBe("");
	expect(menu.filterFocused).toBe(false);
	menu.handleInput("j");
	expect(menu.getSelected()?.id).toBe("model-01");
	menu.handleInput("/");
	for (const key of "hjklg/G ") menu.handleInput(key);
	expect(menu.query).toBe("hjklg/G ");
	menu.handleInput("\x1b");
	expect(menu.filterFocused).toBe(false);
	expect(menu.query).toBe("hjklg/G ");
});

test("model browser jumps, half-pages and pages without wrapping", () => {
	const menu = browser();
	menu.render(100);
	menu.handleInput("\x04");
	expect(menu.getSelected()?.id).toBe("model-03");
	menu.handleInput("\x1b[6~");
	expect(menu.getSelected()?.id).toBe("model-09");
	menu.handleInput("\x15");
	expect(menu.getSelected()?.id).toBe("model-06");
	menu.handleInput("G");
	expect(menu.getSelected()?.id).toBe("model-29");
	menu.handleInput("j");
	expect(menu.getSelected()?.id).toBe("model-29");
	menu.handleInput("g");
	menu.handleInput("g");
	expect(menu.getSelected()?.id).toBe("model-00");
});

test("model browser viewport scroll never relocates selection", () => {
	const menu = browser();
	menu.render(100);
	const selected = menu.getSelected();
	menu.handleInput("\x05");
	expect(menu.navigationSnapshot().top).toEqual({ item: 1, lineOffset: 0 });
	expect(menu.getSelected()).toBe(selected);
	expect(menu.render(100).slice(2, 8).join("\n")).not.toContain("model-00");
	menu.handleInput("\x19");
	expect(menu.navigationSnapshot().top).toEqual({ item: 0, lineOffset: 0 });
	expect(menu.getSelected()).toBe(selected);
});

test("focused model search retains editing keys and Esc does not close", () => {
	const menu = browser();
	let closed = 0;
	menu.onCancel = () => { closed++; };
	menu.handleInput("/");
	for (const key of "model") menu.handleInput(key);
	menu.handleInput("\x15");
	expect(menu.query).toBe("");
	menu.handleInput("\x1b");
	expect(closed).toBe(0);
	menu.handleInput("\x1b");
	expect(closed).toBe(1);
});

test("model navigation restores query, caret, selection, focus and viewport", () => {
	const menu = browser();
	menu.handleInput("/");
	for (const key of "model") menu.handleInput(key);
	menu.handleInput("\x1b[D");
	menu.handleInput("\x1b");
	menu.handleInput("G");
	menu.render(100);
	menu.handleInput("\x19");
	const saved = menu.navigationSnapshot();
	const reopened = browser();
	reopened.restoreNavigation(saved);
	expect(reopened.navigationSnapshot()).toEqual(saved);
});

test("Space activates a single model without creating preview state", () => {
	const menu = browser();
	const picked: string[] = [];
	menu.onActivate = item => { picked.push(item.selector); };
	menu.handleInput(" ");
	expect(picked).toEqual(["test/model-00"]);
});

test("model viewport restores visual positions and accepts older item-boundary snapshots", () => {
	const menu = browser();
	const saved = menu.navigationSnapshot();
	menu.restoreNavigation({ ...saved, top: { item: 5, lineOffset: 0 } });
	expect(menu.navigationSnapshot().top).toEqual({ item: 5, lineOffset: 0 });
	expect(menu.getSelected()?.id).toBe("model-00");
	expect(menu.render(100).slice(2, 8).join("\n")).toContain("model-05");
	menu.restoreNavigation({ ...saved, top: 7 });
	expect(menu.navigationSnapshot().top).toEqual({ item: 7, lineOffset: 0 });
	// Model rows are single-line, so stale offsets clamp without growing the frame.
	menu.restoreNavigation({ ...saved, top: { item: 9, lineOffset: 3 } });
	expect(menu.navigationSnapshot().top).toEqual({ item: 9, lineOffset: 0 });
	expect(menu.render(100)).toHaveLength(menu.renderedRows);
});
