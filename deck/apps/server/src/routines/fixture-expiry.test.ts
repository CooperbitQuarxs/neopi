import { afterAll, afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../db/index.ts";
import { isIsolatedCase, runIsolatedCase } from "../test-isolation.ts";
import { RoutineTestFixtures } from "./test-fixture.ts";

const workerCase = "expired body and cleanup retain the fixture lease";
if (isIsolatedCase(import.meta.path)) {
	const fixtures = new RoutineTestFixtures();
	const saved = { home: process.env.NPI_DECK_HOME, db: process.env.NPI_DECK_DB_PATH, generation: process.env.NPI_DECK_GEN };
	const homes: string[] = [];
	let bodyFinished = false;
	let hooks = 0;
	afterEach(() => { if (++hooks === 1) return fixtures.join(); }, 25);
	afterAll(async () => {
		await fixtures.join();
		expect(homes).toHaveLength(2);
		for (const home of homes) expect(fs.existsSync(home)).toBe(false);
		expect(process.env.NPI_DECK_HOME).toBe(saved.home);
		expect(process.env.NPI_DECK_DB_PATH).toBe(saved.db);
		expect(process.env.NPI_DECK_GEN).toBe(saved.generation);
		expect(() => getDb()).toThrow();
		console.log("fixture resources released");
	}, 30_000);
	test("intentionally expired body", () => fixtures.run(async ({ home }) => {
		homes.push(home);
		await Bun.sleep(150);
		bodyFinished = true;
	}), 25);
	test("successor keeps its actual runner and resource lease across an await", () => fixtures.run(async ({ home, runner }) => {
		homes.push(home);
		const db = getDb();
		const generation = process.env.NPI_DECK_GEN;
		const marker = path.join(home, "successor");
		fs.writeFileSync(marker, "retained");
		await runner.fire("missing-routine");
		await Bun.sleep(1000);
		await runner.fire("missing-routine");
		expect(getDb()).toBe(db);
		expect(db.query("SELECT 42 AS value").get()).toEqual({ value: 42 });
		expect(fs.readFileSync(marker, "utf8")).toBe("retained");
		expect(process.env.NPI_DECK_HOME).toBe(home);
		expect(process.env.NPI_DECK_DB_PATH).toBe(path.join(home, "deck.db"));
		expect(process.env.NPI_DECK_GEN).toBe(generation);
		expect(bodyFinished).toBe(true);
		expect(fs.existsSync(homes[0]!)).toBe(false);
		console.log("successor lease retained");
	}), 30_000);
} else {
	test(workerCase, () => {
		const child = runIsolatedCase(import.meta.path, workerCase);
		// The worker must report the deliberately expired body/hook. Success is
		// the successor assertions and final release, not hiding those failures.
		expect(child.exitCode).not.toBe(0);
		expect(child.output).toContain("successor lease retained");
		expect(child.output).toContain("fixture resources released");
		expect(child.output).toMatch(/\(pass\) successor keeps its actual runner/);
		expect(child.output).toMatch(/timed out/i);
		expect(child.output).toContain("beforeEach/afterEach hook timed out");
	}, 75_000);
}
