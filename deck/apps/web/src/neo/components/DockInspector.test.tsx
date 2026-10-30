import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const reactDom = { ...await import("react-dom") };
mock.module("react-dom", () => ({ ...reactDom, createPortal: (children: unknown) => children }));
afterAll(() => { mock.module("react-dom", () => reactDom); });
const { DockInspector } = await import("./DockInspector");

const originals = new Map(["document", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
	if (renderer) act(() => renderer!.unmount());
	renderer = undefined;
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

function mount() {
	class Element {
		isConnected = true;
		focus = mock(() => {});
	}
	const row = new Element();
	const panel = new Element();
	const overlays: { getClientRects: () => number[] }[] = [];
	Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
	Object.defineProperty(globalThis, "document", { configurable: true, value: {
		getElementById: () => ({}), activeElement: row,
		querySelector: () => row, querySelectorAll: () => overlays,
	} });
	const close = mock(() => {});
	act(() => {
		renderer = create(<DockInspector title="Selected card" subtitle="T-294" returnFocusSelector="[data-board-card]" onClose={close} footer={<button>Delete</button>}><p>Evidence</p></DockInspector>, { createNodeMock: () => panel });
	});
	const root = renderer!.root.findByProps({ className: "neo-dock-inspector" });
	const key = (extra: Record<string, unknown> = {}) => {
		const event = { key: "Escape", defaultPrevented: false, nativeEvent: { isComposing: false }, preventDefault: mock(() => {}), stopPropagation: mock(() => {}), ...extra };
		act(() => root.props.onKeyDown(event));
		return event;
	};
	return { row, panel, close, overlays, root, key };
}

describe("DockInspector", () => {
	test("focuses selection detail and returns focus to its row on close", () => {
		const { row, panel, root } = mount();
		expect(panel.focus).toHaveBeenCalledTimes(1);
		expect(root.props.tabIndex).toBe(-1);
		expect(root.props.role).toBeUndefined();
		expect(root.props["aria-modal"]).toBeUndefined();
		act(() => renderer!.unmount()); renderer = undefined;
		expect(row.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	test("closes on Escape and the close button without claiming Tab", () => {
		const { close, key } = mount();
		expect(key({ key: "Tab" }).preventDefault).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(key().preventDefault).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		act(() => renderer!.root.findByProps({ "aria-label": "Close inspector" }).props.onClick());
		expect(close).toHaveBeenCalledTimes(2);
	});

	test("leaves Escape to composition, handled events and visible nested overlays", () => {
		const { close, key, overlays } = mount();
		key({ nativeEvent: { isComposing: true } });
		key({ defaultPrevented: true });
		overlays.push({ getClientRects: () => [1] }); key();
		expect(close).not.toHaveBeenCalled();
		overlays.splice(0, 1, { getClientRects: () => [] }); key();
		expect(close).toHaveBeenCalledTimes(1);
	});
});
