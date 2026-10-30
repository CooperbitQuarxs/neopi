import { expect, test } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { decodeSwitchDocument } from "../src/switch/config/document";
import { ConfigFields } from "../src/switch/config/fields";
import { prepareProviderModels } from "../src/switch/providers";

function provider(model: Record<string, unknown>) {
	const fields = new ConfigFields();
	const config = decodeSwitchDocument(
		{
			fields,
			warnings: [],
			configDir: "/home/shayna/.cache/npi-canary",
			source: "switch.toml",
			secrets: [],
		},
		{ provider: [{ id: "anthropic", model: [model] }] },
	);
	fields.finish();
	return config.providers[0];
}
const discovered = buildModel({
	id: "existing",
	name: "Existing",
	provider: "anthropic",
	api: "anthropic-messages",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	contextWindow: 10000,
	maxTokens: 1000,
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
});

test.each(["upstream_id", "kind", "context_window", "max_output"])(
	"catalog additions reject a missing explicit %s",
	missing => {
		const model: Record<string, unknown> = {
			id: "added",
			upstream_id: "upstream-added",
			kind: "chat",
			context_window: 10000,
			max_output: 1000,
		};
		delete model[missing];
		expect(() => prepareProviderModels(provider(model), [discovered])).toThrow(
			expect.objectContaining({ code: "model_incomplete" }),
		);
	},
);

test("catalog overrides inherit required model fields instead of becoming additions", () => {
	const result = prepareProviderModels(provider({ id: "existing", name: "Renamed" }), [discovered]);
	expect(result[0].model.name).toBe("Renamed");
	expect(result[0].model.contextWindow).toBe(10000);
	expect(result[0].model.maxTokens).toBe(1000);
});

test("complete catalog additions preserve the declared upstream identifier", () => {
	const result = prepareProviderModels(
		provider({
			id: "added",
			upstream_id: "upstream-added",
			kind: "chat",
			context_window: 10000,
			max_output: 1000,
		}),
		[discovered],
	);
	expect(result.find(entry => entry.model.id === "added")?.model.requestModelId).toBe("upstream-added");
});
