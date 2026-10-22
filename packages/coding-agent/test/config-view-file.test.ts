import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfigViewFile, type ConfigViewFiles } from "../src/config/config-view-file";
import { resetSettingsForTest, Settings } from "../src/config/settings";

const root = path.join(os.homedir(), ".cache/npi-canary/config-view-tests");
const directories: string[] = [];
async function fixture(): Promise<{ dir: string; files: ConfigViewFiles }> {
	await fs.mkdir(root, { recursive: true });
	const dir = await fs.mkdtemp(path.join(root, "resolver-"));
	directories.push(dir);
	return {
		dir,
		files: {
			settings: { getConfigFile: scope => path.join(dir, scope === "project" ? "project" : "user", "config.yaml") },
			models: { getConfigFile: () => path.join(dir, "custom-models.yml") },
		},
	};
}

afterEach(async () => {
	resetSettingsForTest();
	for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("configuration view file mapping", () => {
	test("maps global/project settings and model sections to their real storage files", async () => {
		const { dir, files } = await fixture();
		expect(await resolveConfigViewFile({ kind: "settings" }, files)).toBe(path.join(dir, "user/config.yaml"));
		expect(await resolveConfigViewFile({ kind: "settings", scope: "project" }, files)).toBe(
			path.join(dir, "project/config.yaml"),
		);
		for (const section of ["roles", "effort", "context"] as const) {
			expect(await resolveConfigViewFile({ kind: "models", section, scope: "project" }, files)).toBe(
				path.join(dir, "project/config.yaml"),
			);
		}
		expect(await resolveConfigViewFile({ kind: "models", section: "overrides" }, files)).toBe(
			path.join(dir, "custom-models.yml"),
		);
	});

	test("opens same-name TOML companions and existing settings.toml without creating files", async () => {
		const { dir, files } = await fixture();
		await Bun.write(path.join(dir, "user/settings.toml"), "");
		expect(await resolveConfigViewFile({ kind: "settings" }, files)).toBe(path.join(dir, "user/settings.toml"));
		await Bun.write(path.join(dir, "user/config.toml"), "");
		expect(await resolveConfigViewFile({ kind: "models", section: "roles" }, files)).toBe(
			path.join(dir, "user/config.toml"),
		);
		await Bun.write(path.join(dir, "custom-models.toml"), "");
		expect(await resolveConfigViewFile({ kind: "models", section: "overrides" }, files)).toBe(
			path.join(dir, "custom-models.toml"),
		);
		const watchdog = path.join(dir, "WATCHDOG.yaml");
		await Bun.write(path.join(dir, "WATCHDOG.toml"), "");
		expect(await resolveConfigViewFile({ kind: "advisor", filePath: watchdog }, files)).toBe(
			path.join(dir, "WATCHDOG.toml"),
		);
	});

	test("preserves selected agent definitions and handles bundled agents without a source", async () => {
		const { dir, files } = await fixture();
		const agent = path.join(dir, "agents/reviewer.md");
		expect(await resolveConfigViewFile({ kind: "agent", filePath: agent }, files)).toBe(agent);
		expect(await resolveConfigViewFile({ kind: "agent" }, files)).toBeUndefined();
		expect(await Bun.file(agent).exists()).toBe(false);
	});

	test("real Settings.init works without any external-editor configuration", async () => {
		const { dir, files } = await fixture();
		const settings = await Settings.init({ agentDir: path.join(dir, "agent"), cwd: dir });
		expect(await resolveConfigViewFile({ kind: "settings" }, { ...files, settings })).toBe(settings.getConfigFile());
		expect(await Bun.file(path.join(dir, "agent/config.toml")).exists()).toBe(false);
	});
});
