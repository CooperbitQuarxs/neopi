import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeWithRetries } from "../../utils/src/temp";
import { AdminAuthentication } from "../src/switch/admin-auth";
import { adminEventsStream } from "../src/switch/admin-stream";
import type { AdminConfig, SwitchConfig } from "../src/switch/config/types";
import { tokenDigest } from "../src/switch/crypto";
import { SwitchDatabase } from "../src/switch/database";
import { SwitchStore } from "../src/switch/store";

const token = "Bearer replay-test-token";
const actor = { name: "operator", role: "read" } as const;
let directory = "";
let database: SwitchDatabase;
let store: SwitchStore;
let config: SwitchConfig;
let admin: AdminConfig;
let authentication: AdminAuthentication;

beforeEach(async () => {
	const scratch = path.join(os.homedir(), ".cache", "npi-canary");
	await fs.mkdir(scratch, { recursive: true });
	directory = await fs.mkdtemp(path.join(scratch, "switch-stream-329-"));
	admin = {
		socket: true,
		corsOrigins: [],
		allowRemote: false,
		backupDir: directory,
		tokens: [{ ...actor, secret: { kind: "sealed", sha256: tokenDigest("replay-test-token").slice(7) } }],
	};
	authentication = new AdminAuthentication(admin, new Map());
	config = {
		switch: {
			name: "replay-test",
			stateDir: directory,
			drainMs: 100,
			metersTtlS: 60,
			metersMinS: 1,
			repairs: "off",
			timezone: "UTC",
			maxAttempts: 1,
			warnAt: [],
			decisionDays: 7,
		},
		admin,
		notify: [],
		providers: [],
		plans: [],
		endpoints: [],
		models: [],
		sources: [],
		digest: "test-config",
	};
	database = await SwitchDatabase.open(directory);
	store = new SwitchStore(database, {
		config,
		generation: "test-generation",
		plans: [],
		modelReferenceKnown: () => false,
		observeUsage: () => {},
	});
	store.markReady();
});

afterEach(async () => {
	store?.shutdown();
	if (directory) {
		await removeWithRetries(directory);
		directory = "";
	}
});

function retainChanges(count: number): void {
	database.transaction(() => {
		for (let index = 0; index < count; index++) {
			database.appendChange("state", {
				cursor: `${store.bootEpoch}:0`,
				at: Date.now(),
				generation: "test-generation",
				resources: [{ kind: "overview", version: String(index) }],
			});
		}
	});
}

test("a paused replay does not buffer retained history past revoked operator authority", async () => {
	retainChanges(1_024);
	const response = adminEventsStream(store, `${store.bootEpoch}:0`, actor, token, () => authentication);
	const reader = response.body!.getReader();
	try {
		authentication = new AdminAuthentication({ ...admin, tokens: [] }, new Map());
		let replayed = 0;
		let resync: string | undefined;
		while (replayed <= 256) {
			const chunk = await reader.read();
			if (chunk.done) break;
			const text = new TextDecoder().decode(chunk.value);
			if (text.includes("event: resync\n")) {
				resync = text;
				break;
			}
			replayed++;
		}
		expect(replayed).toBeLessThanOrEqual(256);
		expect(resync).toContain('"reason":"operator_authority_changed"');
		expect((await reader.read()).done).toBe(true);
	} finally {
		await reader.cancel();
	}
});

test("replay crosses retained pages before delivering changes published while paused", async () => {
	retainChanges(600);
	const response = adminEventsStream(store, `${store.bootEpoch}:17`, actor, token, () => authentication);
	const reader = response.body!.getReader();
	try {
		store.publishGeneration("operator", config, "live-generation", [], [], []);
		const decoder = new TextDecoder();
		for (let sequence = 18; sequence <= 600; sequence++) {
			const chunk = await reader.read();
			expect(chunk.done).toBe(false);
			const text = decoder.decode(chunk.value);
			expect(text).toStartWith(`id: ${store.bootEpoch}:${sequence}\nevent: state\n`);
			expect(text).toContain('"generation":"test-generation"');
		}
		const live = await reader.read();
		expect(live.done).toBe(false);
		const text = decoder.decode(live.value);
		expect(text).toStartWith(`id: ${store.bootEpoch}:601\n`);
		expect(text).toContain('"generation":"live-generation"');
	} finally {
		await reader.cancel();
	}
});

test("a paused replay requests resync when unread retained pages expire", async () => {
	retainChanges(1_024);
	const response = adminEventsStream(store, `${store.bootEpoch}:0`, actor, token, () => authentication);
	const reader = response.body!.getReader();
	try {
		const tomorrow = Date.now() + 86_400_000;
		database.prune(tomorrow, tomorrow, tomorrow);
		let replayed = 0;
		let resync: string | undefined;
		const decoder = new TextDecoder();
		while (replayed <= 256) {
			const chunk = await reader.read();
			if (chunk.done) break;
			const text = decoder.decode(chunk.value);
			if (text.includes("event: resync\n")) {
				resync = text;
				break;
			}
			replayed++;
		}
		expect(replayed).toBeLessThanOrEqual(256);
		expect(resync).toContain('"reason":"replay_expired"');
		expect((await reader.read()).done).toBe(true);
	} finally {
		await reader.cancel();
	}
});
