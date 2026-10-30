import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ShortcutProvider, shortcutBlocked, usePageShortcuts } from "./shortcuts";

let renderer: ReactTestRenderer | undefined;
let listeners: Map<string, Set<(event: any) => void>>;
let overlays: { getClientRects: () => unknown[] }[];
const saved = new Map(["window", "document", "Element"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
class Target { constructor(readonly editing = false) {} closest() { return this.editing ? this : null; } }
beforeEach(() => {
	listeners = new Map(); overlays = [];
	Object.defineProperty(globalThis, "Element", { configurable: true, value: Target });
	Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelectorAll: () => overlays } });
	Object.defineProperty(globalThis, "window", { configurable: true, value: {
		addEventListener: (key: string, fn: (event: any) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
		removeEventListener: (key: string, fn: (event: any) => void) => listeners.get(key)?.delete(fn),
	} });
});
afterEach(() => {
	if (renderer) act(() => renderer!.unmount()); renderer = undefined;
	for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
function event(key: string, extra = {}): KeyboardEvent { return { key, target: null, preventDefault: mock(() => {}), ...extra } as unknown as KeyboardEvent; }
function send(key: string, extra = {}) { const value = event(key, extra); act(() => { for (const listener of listeners.get("keydown") ?? []) listener(value); }); return value; }
const focus = mock(() => {});
const action = mock(() => {});
let path = "";
function Page({ enabled = true }: { enabled?: boolean }) {
	path = useLocation().pathname;
	usePageShortcuts({ search: { current: { focus, getClientRects: () => [{}] } as unknown as HTMLInputElement }, shortcuts: [{ key: "m", label: "Map", run: action }] }, enabled);
	return null;
}
function mount(enabled = true) { act(() => { renderer = create(<MemoryRouter initialEntries={["/board"]}><ShortcutProvider><Page enabled={enabled} /></ShortcutProvider></MemoryRouter>); }); }

test("page search and registered actions unregister when disabled", () => {
	focus.mockClear(); action.mockClear(); mount();
	send("/"); send("M");
	expect(focus).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1);
	act(() => { renderer!.update(<MemoryRouter initialEntries={["/board"]}><ShortcutProvider><Page enabled={false} /></ShortcutProvider></MemoryRouter>); });
	send("/"); send("m");
	expect(focus).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1);
});

test("G G navigates to GitHub, Escape cancels an armed chord, Alt M is retained", () => {
	mount(); send("g"); send("g"); expect(path).toBe("/github");
	send("g"); send("Escape"); send("b"); expect(path).toBe("/github");
	send("m", { altKey: true }); expect(path).toBe("/models");
});

test("editing, IME, overlays and held keys suppress page and navigation actions", () => {
	focus.mockClear(); action.mockClear(); mount();
	for (const extra of [{ target: new Target(true) }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { repeat: true }]) {
		send("/", extra); send("m", extra); send("g", extra); send("i", extra);
	}
	overlays = [{ getClientRects: () => [{}] }]; send("/"); send("m"); send("g"); send("i");
	expect(focus).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled(); expect(path).toBe("/board");
	overlays = [{ getClientRects: () => [] }]; send("/"); expect(focus).toHaveBeenCalledTimes(1);
});

test("composition and focus loss cancel a pending route chord", () => {
	mount(); send("g"); for (const listener of listeners.get("compositionstart") ?? []) listener({});
	send("i"); for (const listener of listeners.get("compositionend") ?? []) listener({});
	send("i"); expect(path).toBe("/board");
	send("g"); for (const listener of listeners.get("blur") ?? []) listener({}); send("i"); expect(path).toBe("/board");
});

test("visible overlays block shortcuts even when focus is outside them", () => {
	expect(shortcutBlocked(event("?"))).toBe(false);
	overlays = [{ getClientRects: () => [{}] }]; expect(shortcutBlocked(event("?"))).toBe(true);
});
