import { describe, expect, it } from "bun:test";
import {
	getToolArgumentCompletions,
	getToolArgumentInlineHint,
	parseHumanToolArguments,
	parseHumanToolCommand,
} from "../../src/slash-commands/tool-arguments";

const fileSchema = {
	type: "object",
	properties: {
		path: { type: "string", description: "File to read" },
		format: { enum: ["text", "json"] },
		limit: { type: "integer" },
		verbose: { type: "boolean" },
	},
	required: ["path"],
};

const actionSchema = {
	$defs: {
		read: {
			type: "object",
			properties: { action: { const: "read" }, path: { type: "string" }, encoding: { enum: ["utf8", "base64"] } },
			required: ["action", "path"],
		},
		search: {
			type: "object",
			properties: { action: { const: "search" }, query: { type: "string" }, scope: { enum: ["files", "content"] } },
			required: ["action", "query"],
		},
	},
	oneOf: [{ $ref: "#/$defs/read" }, { $ref: "#/$defs/search" }],
};

describe("human tool arguments", () => {
	it("parses JSON objects and explicit empty arguments", () => {
		expect(parseHumanToolArguments(' {"path":"a b.ts","limit":3,"enabled":false,"items":[1,null]} ')).toEqual({
			path: "a b.ts",
			limit: 3,
			enabled: false,
			items: [1, null],
		});
		expect(parseHumanToolArguments("{}")).toEqual({});
	});

	it("parses quoted strings and structured JSON values with spaces", () => {
		expect(
			parseHumanToolArguments(
				`path="a b.ts" label='hello world' config={"items": [1, 2], "name": "a b"} list=["x y", false]`,
			),
		).toEqual({
			path: "a b.ts",
			label: "hello world",
			config: { items: [1, 2], name: "a b" },
			list: ["x y", false],
		});
	});

	it("keeps quoted scalar-looking values as strings", () => {
		expect(parseHumanToolArguments(`number="42" boolean='false' empty=""`)).toEqual({
			number: "42",
			boolean: "false",
			empty: "",
		});
		expect(parseHumanToolArguments("number=-4.25 enabled=true absent=null")).toEqual({
			number: -4.25,
			enabled: true,
			absent: null,
		});
	});

	it("preserves bare paths, backslashes and equals signs", () => {
		expect(
			parseHumanToolArguments(
				String.raw`path=C:\Users\Shayna\file.ts other=~/source/a.ts url=https://example.test/?a=b`,
			),
		).toEqual({
			path: String.raw`C:\Users\Shayna\file.ts`,
			other: "~/source/a.ts",
			url: "https://example.test/?a=b",
		});
	});

	it("accepts escaped quotes and braces inside JSON strings", () => {
		expect(parseHumanToolArguments(String.raw`text="a \"quoted\" } value" items=[{"text": "}"}, "["]`)).toEqual({
			text: 'a "quoted" } value',
			items: [{ text: "}" }, "["],
		});
	});

	it("rejects duplicate keys in either syntax, including nested and escaped JSON keys", () => {
		for (const text of [
			"path=a path=b",
			'{"path":"a","path":"b"}',
			String.raw`{"path":"a","\u0070ath":"b"}`,
			'options={"nested":{"key":1,"key":2}}',
			'{"items":[{"a":1,"a":2}]}',
		])
			expect(() => parseHumanToolArguments(text)).toThrow("Duplicate tool argument key");
	});

	it("allows the same key in different objects", () => {
		expect(parseHumanToolArguments('items=[{"id":1},{"id":2}]')).toEqual({ items: [{ id: 1 }, { id: 2 }] });
	});

	it("passes schema-owned keys as data without mutating the argument prototype", () => {
		const args = parseHumanToolArguments('__proto__={"polluted":true} constructor=x prototype=y');
		expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
		expect(Object.hasOwn(args, "__proto__")).toBe(true);
		expect(args.__proto__).toEqual({ polluted: true });
		expect(args.constructor as unknown).toBe("x");
		expect(args.prototype).toBe("y");
		expect(parseHumanToolArguments('{"config":{"constructor":{"prototype":1}}}')).toEqual({
			config: { constructor: { prototype: 1 } },
		});
	});

	it("rejects incomplete, non-object and mixed argument syntax", () => {
		for (const text of [
			"",
			" ",
			"[]",
			"null",
			"word",
			"=value",
			"path=",
			'path="unfinished',
			"path='unfinished",
			"items=[1, 2",
			'config={"a":1}junk',
			"path=a extra",
		]) {
			expect(() => parseHumanToolArguments(text)).toThrow();
		}
	});

	it("splits command names without lowercasing or discarding internal colons", () => {
		expect(parseHumanToolCommand('  Server:Read\t path="a b"  ')).toEqual({
			name: "Server:Read",
			argumentsText: 'path="a b"',
		});
		expect(parseHumanToolCommand("Server:Read")).toEqual({ name: "Server:Read", argumentsText: "" });
		expect(parseHumanToolCommand(" ")).toEqual({ name: "", argumentsText: "" });
	});
});

describe("tool schema argument completion", () => {
	it("offers fields, descriptions and required-field ghost text", () => {
		expect(getToolArgumentCompletions(fileSchema, "pa")).toEqual([
			{ value: "path=", label: "path=", description: "File to read", hint: "th=<string>" },
		]);
		expect(getToolArgumentInlineHint(fileSchema, "")).toBe("path=<string>");
		expect(getToolArgumentInlineHint(fileSchema, "path=")).toBe("<string>");
		expect(getToolArgumentInlineHint(fileSchema, 'path="file.ts"')).toBeNull();
	});

	it("replaces the full prefix without repeating already supplied fields", () => {
		const items = getToolArgumentCompletions(fileSchema, 'path="a b" f');
		expect(items?.map(item => item.value)).toEqual(['path="a b" format=']);
		expect(getToolArgumentCompletions(fileSchema, "path=a ")?.map(item => item.label)).not.toContain("path=");
	});

	it("completes enum, const and boolean values", () => {
		expect(getToolArgumentCompletions(fileSchema, "format=j")?.map(item => item.value)).toEqual(["format=json"]);
		expect(getToolArgumentCompletions(fileSchema, 'format="j')?.map(item => item.value)).toEqual(['format="json"']);
		expect(getToolArgumentCompletions(fileSchema, "format='j")?.map(item => item.value)).toEqual(["format='json'"]);
		expect(getToolArgumentCompletions(fileSchema, "verbose=")?.map(item => item.value)).toEqual([
			"verbose=true",
			"verbose=false",
		]);
		expect(getToolArgumentCompletions(actionSchema, "action=r")?.map(item => item.value)).toEqual(["action=read"]);
		expect(getToolArgumentInlineHint(actionSchema, "action=r")).toBe("ead");
	});

	it("quotes enum strings that would otherwise parse as scalars or empty values", () => {
		const schema = { type: "object", properties: { value: { enum: ["true", "42", "null", "", "two words"] } } };
		const items = getToolArgumentCompletions(schema, "value=");
		expect(items?.map(item => parseHumanToolArguments(item.value).value)).toEqual([
			"true",
			"42",
			"null",
			"",
			"two words",
		]);
	});

	it("resolves referenced discriminated unions and excludes incompatible fields", () => {
		expect(getToolArgumentCompletions(actionSchema, "action=read ")?.map(item => item.label)).toEqual([
			"path=",
			"encoding=",
		]);
		expect(getToolArgumentCompletions(actionSchema, "action=search ")?.map(item => item.label)).toEqual([
			"query=",
			"scope=",
		]);
		expect(getToolArgumentCompletions(actionSchema, "action=search encoding=")).toBeNull();
		expect(getToolArgumentInlineHint(actionSchema, "action=read ")).toBe("path=<string>");
		expect(getToolArgumentInlineHint(actionSchema, "action=search ")).toBe("query=<string>");
		expect(getToolArgumentInlineHint(actionSchema, "")).toMatch(/^action=</);
		expect(getToolArgumentInlineHint(actionSchema, "")).not.toContain("path=");
	});

	it("combines allOf requirements and narrows anyOf variants", () => {
		const schema = {
			allOf: [
				{ type: "object", properties: { cwd: { type: "string" } }, required: ["cwd"] },
				{
					anyOf: [
						{
							properties: { mode: { enum: ["read", "inspect"] }, path: { type: "string" } },
							required: ["mode", "path"],
						},
						{ properties: { mode: { const: "search" }, query: { type: "string" } }, required: ["mode", "query"] },
					],
				},
			],
		};
		expect(getToolArgumentCompletions(schema, "mode=inspect ")?.map(item => item.label)).toEqual(["cwd=", "path="]);
		expect(getToolArgumentInlineHint(schema, "mode=search ")).toBe("cwd=<string> query=<string>");
	});

	it("completes JSON keys and values using the selected discriminator", () => {
		expect(getToolArgumentCompletions(actionSchema, '{"action":"read", "p')?.map(item => item.value)).toEqual([
			'{"action":"read", "path": ',
		]);
		expect(
			getToolArgumentCompletions(actionSchema, '{"action":"read", "encoding": "b')?.map(item => item.value),
		).toEqual(['{"action":"read", "encoding": "base64"']);
		expect(getToolArgumentInlineHint(actionSchema, '{"action":"search", ')).toBe('"query": <string>');
		expect(getToolArgumentCompletions(fileSchema, '{"path":"done"}')).toBeNull();
		expect(getToolArgumentInlineHint(fileSchema, "{}")).toBeNull();
	});

	it("keeps preceding structured values intact while completing later fields", () => {
		const schema = { type: "object", properties: { config: { type: "object" }, mode: { enum: ["safe", "fast"] } } };
		expect(getToolArgumentCompletions(schema, 'config={"items": [1, 2]} mode=s')?.map(item => item.value)).toEqual([
			'config={"items": [1, 2]} mode=safe',
		]);
		expect(getToolArgumentCompletions(schema, '{"config":{"items":[1, 2]}, "mo')?.map(item => item.value)).toEqual([
			'{"config":{"items":[1, 2]}, "mode": ',
		]);
	});

	it("declines unknown refs, non-object schemas, invalid prefixes and impossible discriminators", () => {
		for (const schema of [
			true,
			false,
			null,
			{ type: "array" },
			{ $ref: "https://example.test/schema" },
			{ $defs: {}, $ref: "#/$defs/missing" },
		]) {
			expect(getToolArgumentCompletions(schema, "")).toBeNull();
			expect(getToolArgumentInlineHint(schema, "")).toBeNull();
		}
		expect(getToolArgumentCompletions(actionSchema, "action=missing ")).toBeNull();
		expect(getToolArgumentCompletions(fileSchema, "path=a path=b ")).toBeNull();
		expect(getToolArgumentCompletions(fileSchema, 'path="unfinished ')).toBeNull();
	});
});
