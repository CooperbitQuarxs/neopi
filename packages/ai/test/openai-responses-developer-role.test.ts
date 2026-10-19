import { describe, expect, it } from "bun:test";
import { convertMessages } from "@oh-my-pi/pi-ai/providers/openai-completions";
import { buildTransformedCodexRequestBody } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import { buildResponsesInput } from "@oh-my-pi/pi-ai/providers/openai-shared";
import type { Context, ImageContent } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";

interface ResponsesCompatTestSpec {
	id?: string;
	name: string;
	provider: string;
	baseUrl: string;
}

function buildOpenAIResponsesCompat(spec: ResponsesCompatTestSpec) {
	return resolveModelPolicy({
		id: spec.id ?? "test-model",
		api: "openai-responses",
		provider: spec.provider,
		baseUrl: spec.baseUrl,
		name: spec.name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	}).compat;
}

describe("resolveOpenAIResponsesCompat supportsDeveloperRole", () => {
	it("returns false for openai provider with custom proxy base URL", () => {
		const model = { provider: "openai", name: "Test Model", baseUrl: "https://my-proxy.example.com/v1" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(false);
	});

	it("returns false for github-copilot provider with custom proxy base URL", () => {
		const model = { provider: "github-copilot", name: "Test Model", baseUrl: "https://proxy.example.com/v1" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(false);
	});

	it("returns true for Azure OpenAI base URL", () => {
		const model = {
			provider: "azure-openai",
			name: "Test Model",
			baseUrl: "https://my-resource.openai.azure.com/openai",
		};
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns true for Azure AI Inference base URL", () => {
		const model = {
			provider: "azure-openai",
			name: "Test Model",
			baseUrl: "https://models.inference.ai.azure.com/v1/chat/completions",
		};
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns true for api.openai.com base URL", () => {
		const model = { provider: "custom", name: "Test Model", baseUrl: "https://api.openai.com/v1/chat/completions" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns false for local/localhost endpoints", () => {
		const model = { provider: "custom", name: "Test Model", baseUrl: "http://localhost:8080/v1" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(false);
	});

	it("is case-insensitive for base URL matching", () => {
		const model = { provider: "custom", name: "Test Model", baseUrl: "https://API.OPENAI.COM/v1" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns true for azure.com/openai base URL", () => {
		const model = {
			provider: "custom",
			name: "Test Model",
			baseUrl: "https://azure.com/openai/deployments/my-model",
		};
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns true for github-copilot provider with api.enterprise.githubcopilot.com", () => {
		const model = {
			provider: "github-copilot",
			name: "Test Model",
			baseUrl: "https://api.enterprise.githubcopilot.com",
		};
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});

	it("returns true for github-copilot provider with copilot-api enterprise domain", () => {
		const model = { provider: "github-copilot", name: "Test Model", baseUrl: "https://copilot-api.mycompany.com" };
		expect(buildOpenAIResponsesCompat(model).supportsDeveloperRole).toBe(true);
	});
});

describe("operator developer-message wire roles", () => {
	const spec = {
		id: "notice-role-test",
		name: "Notice role test",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 1024,
	};
	const notice = "<system-notice>\nOperator notice\nsecond line\n</system-notice>";
	for (const supportsDeveloperRole of [true, false]) {
		for (const blockContent of [true, false]) {
			for (const role of ["user", "developer"] as const) {
				const context: Context = {
					messages: [
						{
							role,
							content: blockContent ? [{ type: "text", text: notice }] : notice,
							attribution: "user",
							timestamp: 1,
						},
					],
				};
				const expectedRole = role === "developer" && supportsDeveloperRole ? "developer" : "user";
				it(`serializes ${blockContent ? "block" : "string"} Chat ${role} input with developer support ${supportsDeveloperRole}`, () => {
					const model = buildModel({
						...spec,
						api: "openai-completions",
						compat: { supportsDeveloperRole },
					});
					expect(convertMessages(model, context, model.compat)).toEqual([
						{
							role: expectedRole,
							content: blockContent ? [{ type: "text", text: notice }] : notice,
						},
					]);
				});
				it(`serializes ${blockContent ? "block" : "string"} Responses ${role} input with developer support ${supportsDeveloperRole}`, () => {
					const model = buildModel({
						...spec,
						api: "openai-responses",
						compat: { supportsDeveloperRole },
					});
					expect(
						buildResponsesInput({
							model,
							context,
							strictResponsesPairing: true,
							supportsImageDetailOriginal: false,
						}),
					).toEqual([
						{
							role: expectedRole,
							content: [{ type: "input_text", text: notice }],
						},
					]);
				});
			}
		}
	}
	for (const role of ["user", "developer"] as const) {
		for (const supportsDeveloperRole of [true, false]) {
			it(`keeps ${role} image content user-role with developer support ${supportsDeveloperRole}`, () => {
				const image: ImageContent = { type: "image", data: "dGVzdA==", mimeType: "image/png", detail: "low" };
				const context: Context = {
					messages: [{ role, content: [{ type: "text", text: notice }, image], timestamp: 1 }],
				};
				const chat = buildModel({
					...spec,
					api: "openai-completions",
					input: ["text", "image"],
					compat: { supportsDeveloperRole },
				});
				expect(convertMessages(chat, context, chat.compat)).toEqual([
					{
						role: "user",
						content: [
							{ type: "text", text: notice },
							{
								type: "image_url",
								image_url: { url: "data:image/png;base64,dGVzdA==", detail: "low" },
							},
						],
					},
				]);
				const responses = buildModel({
					...spec,
					api: "openai-responses",
					input: ["text", "image"],
					compat: { supportsDeveloperRole },
				});
				expect(
					buildResponsesInput({
						model: responses,
						context,
						strictResponsesPairing: true,
						supportsImageDetailOriginal: false,
					}),
				).toEqual([
					{
						role: "user",
						content: [
							{ type: "input_text", text: notice },
							{
								type: "input_image",
								image_url: "data:image/png;base64,dGVzdA==",
								detail: "low",
							},
						],
					},
				]);
			});
		}
	}
	it("omits synthetic user fallback only when serializing Codex retention candidates", async () => {
		const model = buildModel({
			...spec,
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.example/backend-api",
		});
		const context: Context = { messages: [{ role: "developer", content: notice, timestamp: 1 }] };
		const normal = await buildTransformedCodexRequestBody(model, context, undefined);
		expect(normal.input?.map(item => item.role)).toEqual(["developer", "user"]);
		const retained = await buildTransformedCodexRequestBody(model, context, undefined, undefined, undefined, false);
		expect(retained.input).toEqual([{ role: "developer", content: [{ type: "input_text", text: notice }] }]);
	});
});
