import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadSwitchConfig } from "../src/switch/config/load";

let directory: string;
beforeEach(async () => {
	const scratch = "/home/shayna/.cache/npi-canary";
	await fs.mkdir(scratch, { recursive: true });
	directory = await fs.mkdtemp(path.join(scratch, "switch-config-329-"));
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

test("endpoint connections resolve providers declared only in providers.d", async () => {
	await Bun.write(path.join(directory, "switch.toml"), `
[[endpoint]]
bind = "127.0.0.1:38291"
route = "/v1/chat/completions"
connect = ["fragment", "fragment/*"]
`);
	await Bun.write(path.join(directory, "providers.d/local.toml"), `
[[provider]]
id = "fragment"
kind = "http"
protocol = "openai-chat"
base_url = "http://127.0.0.1:38292/v1"
auth = { scheme = "none" }
`);
	const { config } = await loadSwitchConfig(directory, { credentialCount: () => 0 });
	expect(config.endpoints[0].connect).toEqual([
		{ kind: "provider", provider: "fragment" },
		{ kind: "provider-glob", provider: "fragment", glob: "*" },
	]);
});

test.each([
	[undefined, "backups"],
	["snapshots", "snapshots"],
	["absolute", "absolute"],
] as const)("admin backup directory %s resolves beneath state_dir", async (configured, expected) => {
	const stateDir = path.join(directory, "service-state");
	const absolute = path.join(directory, "external-backups");
	await Bun.write(path.join(directory, "switch.toml"), `
provider = []
[switch]
state_dir = "${stateDir}"
[admin]
${configured ? `backup_dir = "${configured === "absolute" ? absolute : configured}"` : ""}
[[admin.token]]
name = "owner"
secret = "private-test-token"
role = "write"
`);
	const { config } = await loadSwitchConfig(directory, { credentialCount: () => 0 });
	expect(config.admin?.backupDir).toBe(configured === "absolute" ? absolute : path.join(stateDir, expected));
});

test("declared attribution rejects an omitted meter list before publication", async () => {
	await Bun.write(path.join(directory, "switch.toml"), `
[[provider]]
id = "anthropic"
[[plan]]
id = "team"
provider = "anthropic"
attribution = "declared"
size = { weekly = { requests = 1000 } }
`);
	await expect(loadSwitchConfig(directory, { credentialCount: () => 1 })).rejects.toMatchObject({
		code: "validation",
		detail: { issues: expect.arrayContaining([expect.objectContaining({ code: "E-PLAN-SIZE" })]) },
	});
});
