import { describe, expect, test } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { resolveIssuesRoleSelection } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

const sol = createMockModel({ provider: "openai-codex", id: "gpt-5.6-sol" }).model;
const luna = createMockModel({ provider: "openai-codex", id: "gpt-5.6-luna" }).model;
const available = [sol, luna];

describe("issues role", () => {
	test("resolves nothing when unassigned, even with default and slow configured", () => {
		const settings = Settings.isolated({
			modelRoles: { default: "openai-codex/gpt-5.6-luna", slow: "openai-codex/gpt-5.6-sol" },
		});
		expect(resolveIssuesRoleSelection(settings, available)).toBeUndefined();
	});

	test("uses the assigned model and its selector effort", () => {
		const settings = Settings.isolated({
			modelRoles: { default: "openai-codex/gpt-5.6-luna", issues: "openai-codex/gpt-5.6-sol:high" },
		});
		const selection = resolveIssuesRoleSelection(settings, available);
		expect(selection?.model).toBe(sol);
		expect(selection?.thinkingLevel).toBe(ThinkingLevel.High);
	});

	test("a saved role effort wins over the selector suffix", () => {
		const settings = Settings.isolated({
			modelRoles: { issues: "openai-codex/gpt-5.6-sol:high" },
			roleEffortSelections: { issues: { mode: "fixed", level: ThinkingLevel.Medium } },
		});
		expect(resolveIssuesRoleSelection(settings, available)?.thinkingLevel).toBe(ThinkingLevel.Medium);
	});

	test("an assignment matching no available model resolves nothing", () => {
		const settings = Settings.isolated({ modelRoles: { issues: "openai-codex/missing-model" } });
		expect(resolveIssuesRoleSelection(settings, available)).toBeUndefined();
	});
});
