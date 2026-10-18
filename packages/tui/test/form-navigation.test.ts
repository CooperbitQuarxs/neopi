import { describe, expect, it } from "bun:test";
import { Form, TextFormField } from "@oh-my-pi/pi-tui/components/form";

const theme = { label: (text: string) => text, description: (text: string) => text, error: (text: string) => text, hint: (text: string) => text };

function field(secret = false): TextFormField {
	return new TextFormField({ theme, secret, initialValue: "draft", onSubmit: () => {}, onCancel: () => {} });
}

describe("form menu history", () => {
	it("restores ordinary draft text, caret and focused field without submitting", () => {
		const first = field();
		const second = field();
		const form = new Form({ fields: [first, second], onCancel: () => {} });
		form.focused = true;
		form.handleInput("\t");
		second.input.setCursor(2);
		const saved = form.navigationSnapshot();
		form.handleInput("hjklgG / ");
		form.handleInput("\x1b[Z");
		form.restoreNavigation(saved);
		expect(second.focused).toBe(true);
		expect(first.focused).toBe(false);
		form.handleInput("X");
		expect(second.getValue()).toBe("drXaft");
	});

	it("never snapshots or restores credential field contents", () => {
		const secret = field(true);
		expect(secret.navigationSnapshot()).toBeUndefined();
		secret.setValue("new credential");
		secret.restoreNavigation({ value: "stale credential", cursor: 0 });
		expect(secret.getValue()).toBe("new credential");
	});
});
