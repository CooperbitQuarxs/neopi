import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Segmented } from "./primitives";

let renderer: ReactTestRenderer | undefined;
const styleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
afterEach(() => {
	if (renderer) act(() => renderer!.unmount());
	renderer = undefined;
	if (styleDescriptor) Object.defineProperty(globalThis, "getComputedStyle", styleDescriptor);
	else Reflect.deleteProperty(globalThis, "getComputedStyle");
});

const options = [{ value: "first", label: "First" }, { value: "second", label: "Second" }];

describe("Segmented", () => {
	test("keeps one tab stop and reports a clicked choice", () => {
		const change = mock(() => {});
		act(() => { renderer = create(<Segmented options={options} value="second" onChange={change} label="Choice" />); });
		const buttons = renderer!.root.findAllByType("button");
		expect(buttons.map(button => button.props.tabIndex)).toEqual([-1, 0]);
		act(() => buttons[0]!.props.onClick());
		expect(change).toHaveBeenCalledWith("first");
	});

	test("moves and selects with arrow keys", () => {
		const change = mock(() => {});
		const focus = [mock(() => {}), mock(() => {})];
		const nodes = focus.map(fn => ({ focus: fn }));
		Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ direction: "ltr" }) });
		act(() => { renderer = create(<Segmented options={options} value="first" onChange={change} />); });
		const preventDefault = mock(() => {});
		act(() => renderer!.root.findByProps({ role: "radiogroup" }).props.onKeyDown({
			key: "ArrowRight", target: nodes[0], currentTarget: { querySelectorAll: () => nodes }, preventDefault,
		}));
		expect(change).toHaveBeenCalledWith("second");
		expect(focus[1]).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalledTimes(1);
	});

	test("disables every choice and ignores keyboard selection", () => {
		const change = mock(() => {});
		act(() => { renderer = create(<Segmented options={options} value="first" onChange={change} disabled />); });
		const group = renderer!.root.findByProps({ role: "radiogroup" });
		expect(group.props["aria-disabled"]).toBe(true);
		expect(renderer!.root.findAllByType("button").every(button => button.props.disabled)).toBe(true);
		act(() => group.props.onKeyDown({ key: "ArrowRight" }));
		expect(change).not.toHaveBeenCalled();
	});
});
