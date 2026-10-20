import { describe, expect, test } from "bun:test";
import { providerEntry } from "@oh-my-pi/pi-catalog/compat/providers";
import { compileProviders } from "../../catalog/scripts/compat-compiler/compile-providers";
import type { DecodeContext } from "../src/switch/config/context";
import { decodeSwitchDocument } from "../src/switch/config/document";
import { ConfigFields } from "../src/switch/config/fields";

function decode(provider: Record<string, unknown>) {
	const context: DecodeContext = {
		fields: new ConfigFields(),
		warnings: [],
		configDir: "/home/shayna/.cache/npi-canary/switch-option-policy",
		source: "switch.toml",
		secrets: [],
	};
	const config = decodeSwitchDocument(context, { provider: [provider] });
	return { provider: config.providers[0], issues: context.fields.issues };
}

const optionPolicies = {
	anthropic: {
		betas: { type: "strings" },
		cache_retention: { type: "enum", values: ["none", "short", "long"] },
	},
	"openai-codex": {
		prefer_websockets: { type: "boolean" },
		text_verbosity: { type: "enum", values: ["low", "medium", "high"] },
	},
	openrouter: { variant: { type: "string" } },
	"kimi-code": { api_format: { type: "enum", values: ["openai", "anthropic"] } },
};

describe("provider option deployment policy", () => {
	test("a new provider declares its option schema without decoder-specific policy", () => {
		const providers = compileProviders([
			{
				file: "providers/new-host.kdl",
				text: `provider "new-host" {
	default-model "model"
	config-options {
		boolean "streaming"
		string "region"
		strings "features"
		enum "retention" "none" "forever"
	}
}`,
			},
		]);
		expect(providers["new-host"]).toMatchObject({
			configOptions: {
				streaming: { type: "boolean" },
				region: { type: "string" },
				features: { type: "strings" },
				retention: { type: "enum", values: ["none", "forever"] },
			},
		});
	});

	for (const [catalog, configOptions] of Object.entries(optionPolicies)) {
		test(`${catalog} resolves its authored option schema`, () => {
			expect(providerEntry(catalog)).toMatchObject({ configOptions });
		});
	}

	for (const [catalog, options] of [
		["anthropic", { betas: ["feature-a", "feature-b"], cache_retention: "long" }],
		["anthropic", { betas: [], cache_retention: "none" }],
		["openai-codex", { prefer_websockets: false, text_verbosity: "medium" }],
		["openrouter", { variant: "fast" }],
		["kimi-code", { api_format: "anthropic" }],
	] as const) {
		test(`${catalog} accepts valid options under a configured provider alias`, () => {
			const result = decode({ id: "custom", catalog, options });
			expect(result.issues).toEqual([]);
			expect(result.provider.options).toEqual(options);
		});
	}

	for (const [catalog, options, suffix, message] of [
		["anthropic", { betas: "feature" }, "betas", "Expected an array"],
		["anthropic", { betas: [""] }, "betas[0]", "Expected a non-empty string"],
		["anthropic", { betas: ["same", "same"] }, "betas", "Duplicate entries are not allowed"],
		["anthropic", { cache_retention: "forever" }, "cache_retention", "Value is not in the supported set"],
		["openai-codex", { prefer_websockets: "true" }, "prefer_websockets", "Expected a boolean"],
		["openai-codex", { text_verbosity: "verbose" }, "text_verbosity", "Value is not in the supported set"],
		["openrouter", { variant: "" }, "variant", "Expected a non-empty string"],
		["kimi-code", { api_format: "responses" }, "api_format", "Value is not in the supported set"],
	] as const) {
		test(`${catalog} rejects invalid ${suffix} with the existing diagnostic`, () => {
			expect(decode({ id: "custom", catalog, options }).issues).toEqual([
				{ code: "E-OPTION", path: `provider[0].options.${suffix}`, message },
			]);
		});
	}

	test("catalog options remain optional", () => {
		for (const catalog of Object.keys(optionPolicies)) {
			expect(decode({ id: "custom", catalog }).issues).toEqual([]);
		}
	});

	test("unknown options report the catalog's accepted names", () => {
		expect(decode({ id: "custom", catalog: "anthropic", options: { mystery: true } }).issues).toEqual([
			{
				code: "E-OPTION",
				path: "provider[0].options.mystery",
				message: "Unknown provider option; accepted keys: headers, betas, cache_retention",
			},
		]);
	});

	test("HTTP providers do not inherit a catalog provider's option policy", () => {
		const result = decode({
			id: "custom",
			kind: "http",
			catalog: "anthropic",
			protocol: "openai-chat",
			base_url: "https://example.test/v1",
			auth: { scheme: "none" },
			options: { betas: ["feature"] },
		});
		expect(result.issues).toEqual([
			{
				code: "E-OPTION",
				path: "provider[0].options.betas",
				message: "Unknown provider option; accepted keys: headers",
			},
		]);
	});

	test("glue admits custom options but still validates known catalog options", () => {
		const options = { custom: { enabled: true }, prefer_websockets: "yes" };
		expect(decode({ id: "custom", catalog: "openai-codex", glue: "./glue.ts", options }).issues).toEqual([
			{
				code: "E-OPTION",
				path: "provider[0].options.prefer_websockets",
				message: "Expected a boolean",
			},
		]);
	});

	test("common header options still validate header values", () => {
		expect(decode({ id: "openrouter", options: { headers: { "X-Example": 42 } } }).issues).toEqual([
			{ code: "E-OPTION", path: "provider[0].options.headers.X-Example", message: "Expected a string" },
		]);
	});
});
