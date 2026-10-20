import { afterEach, beforeEach, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AuthStorage, SqliteAuthCredentialStore } from "../src/auth-storage";
import type { UsageReport } from "../src/usage";
import { decodeSwitchDocument } from "../src/switch/config/document";
import { ConfigFields } from "../src/switch/config/fields";
import type { SwitchConfig } from "../src/switch/config/types";
import { SwitchDatabase } from "../src/switch/database";
import { SwitchMeterCache } from "../src/switch/meter-cache";
import { resolvePlans } from "../src/switch/plans";
import { SwitchStore } from "../src/switch/store";

let directory: string;
let credentials: SqliteAuthCredentialStore;
let storage: AuthStorage;
let store: SwitchStore | undefined;
let config: SwitchConfig;
beforeEach(async () => {
	const scratch = "/home/shayna/.cache/npi-canary";
	await fs.mkdir(scratch, { recursive: true });
	directory = await fs.mkdtemp(path.join(scratch, "switch-meter-329-"));
	credentials = await SqliteAuthCredentialStore.open(path.join(directory, "auth.db"));
	storage = new AuthStorage(credentials);
	const fields = new ConfigFields();
	config = {
		...decodeSwitchDocument({ fields, warnings: [], configDir: directory, source: "switch.toml", secrets: [] }, {
			provider: [{ id: "anthropic" }],
			plan: [{ id: "team", provider: "anthropic", account: { org_id: "org-team" }, meters: ["weekly"] }],
		}),
		sources: [], digest: "meter-test",
	};
	fields.finish();
});
afterEach(async () => {
	vi.restoreAllMocks();
	store?.shutdown();
	store = undefined;
	storage.close();
	await fs.rm(directory, { recursive: true, force: true });
});

test.each([
	["scope", "org-team", "updated"],
	["metadata", "org-team", "updated"],
	["scope", "org-other", "failed"],
	["metadata", "org-other", "failed"],
	["missing", "", "failed"],
] as const)("organization-only meter identity from %s (%s) is %s", async (source, orgId, expected) => {
	await credentials.upsertAuthCredential("anthropic", {
		type: "oauth", access: "test-access", refresh: "test-refresh", expires: Date.now() + 3_600_000,
		orgId: "org-team",
	});
	const { plans } = await resolvePlans(config, storage);
	const database = await SwitchDatabase.open(path.join(directory, "state"));
	store = new SwitchStore(database, {
		config, generation: "generation", plans,
		modelReferenceKnown: () => true, observeUsage: () => {},
	});
	store.markReady();
	const report: UsageReport = {
		provider: "anthropic", fetchedAt: Date.now(),
		...(source === "metadata" ? { metadata: { orgId } } : {}),
		limits: [{
			id: "weekly", label: "Weekly", scope: { provider: "anthropic", ...(source === "scope" ? { orgId } : {}) },
			amount: { unit: "percent", usedFraction: 0.2 },
		}],
	};
	vi.spyOn(storage.usage, "reports").mockResolvedValue([report]);
	const cache = new SwitchMeterCache(store, storage, () => plans, () => "generation", 60, 1);
	try {
		expect((await cache.refresh()).get("team")).toBe(expected);
	} finally {
		cache.stop();
	}
});

test("catalog API-key plans are rejected before publishing an unmatchable meter owner", async () => {
	await credentials.saveApiKey("anthropic", "private-test-key");
	delete config.plans[0].account;
	await expect(resolvePlans(config, storage)).rejects.toMatchObject({
		code: "validation",
		detail: { issues: expect.arrayContaining([expect.objectContaining({ code: "E-PLAN-PROVIDER" })]) },
	});
});
