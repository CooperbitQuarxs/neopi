import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ensurePrivateDataDir } from "../env-store.ts";
import { closeDb, getDb, openDb } from "./index.ts";
import { removeTestPath } from "../test-cleanup.ts";

// deck.db holds webhook signing keys, so neither it, its WAL files, nor the
// data dir may be readable by other users.
const mode = (p: string) => fs.statSync(p).mode & 0o777;
let root = "";

afterEach(() => {
	closeDb();
	if (root) removeTestPath(root);
	root = "";
});

describe.skipIf(process.platform === "win32")("private data files", () => {
	test("a new database and its WAL files are created owner-only", () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-db-mode-"));
		const dbPath = path.join(root, "data", "deck.db");
		openDb({ path: dbPath });
		getDb().exec("CREATE TABLE IF NOT EXISTS mode_probe (x); INSERT INTO mode_probe VALUES (1);");

		expect(mode(path.dirname(dbPath))).toBe(0o700);
		expect(mode(dbPath)).toBe(0o600);
		expect(mode(`${dbPath}-wal`)).toBe(0o600);
		expect(mode(`${dbPath}-shm`)).toBe(0o600);
	});

	test("an existing world-readable database and WAL files are narrowed to the owner on open", () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-db-mode-"));
		const dbPath = path.join(root, "deck.db");
		openDb({ path: dbPath });
		getDb().exec("CREATE TABLE IF NOT EXISTS mode_probe (x); INSERT INTO mode_probe VALUES (1);");
		closeDb();
		for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
			if (!fs.existsSync(file)) fs.writeFileSync(file, "");
			fs.chmodSync(file, 0o644);
		}

		openDb({ path: dbPath });

		expect(mode(dbPath)).toBe(0o600);
		expect(mode(`${dbPath}-wal`)).toBe(0o600);
		expect(mode(`${dbPath}-shm`)).toBe(0o600);
	});

	test("the data dir is made owner-only, whether new or left at 0755 by an older deck", () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-dir-mode-"));
		const fresh = path.join(root, "fresh", ".npi-deck");
		ensurePrivateDataDir(fresh);
		expect(mode(fresh)).toBe(0o700);

		const existing = path.join(root, "existing");
		fs.mkdirSync(existing, { mode: 0o755 });
		fs.chmodSync(existing, 0o755);
		ensurePrivateDataDir(existing);
		expect(mode(existing)).toBe(0o700);
	});
});

test("close releases database files before retained statement objects are collected", () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-db-release-"));
	const fixture = path.join(root, "fixture");
	const dbModule = new URL("./index.ts", import.meta.url).href;
	const tasksModule = new URL("./tasks.ts", import.meta.url).href;
	const child = Bun.spawnSync({
		cmd: [process.execPath, "--eval", `
			import { Database } from "bun:sqlite";
			import * as fs from "node:fs";
			import * as path from "node:path";
			const fixture = ${JSON.stringify(fixture)};
			const statements = [];
			const prepare = Database.prototype.prepare;
			Database.prototype.prepare = function (...args) {
				const statement = Reflect.apply(prepare, this, args);
				statements.push(statement);
				return statement;
			};
			globalThis.retainedStatements = statements;
			const { openDb, closeDb } = await import(${JSON.stringify(dbModule)});
			const { createState, createTask, updateTask, moveTask } = await import(${JSON.stringify(tasksModule)});
			const db = openDb({ path: path.join(fixture, "deck.db") });
			const kept = db.query("SELECT ? AS kept");
			for (let index = 0; index < 24; index++) {
				db.query("SELECT ? AS value /* release probe " + index + " */").get(index);
			}
			if (kept.get(41).kept !== 41) throw new Error("an earlier statement was invalidated before close");
			const state = createState({ name: "release-probe" });
			const task = createTask({ title: "release-probe" });
			updateTask(task.id, { body: "updated before close" });
			moveTask(task.id, state.id, 0);
			const canonicalFixture = fs.realpathSync(fixture);
			function ownedFiles() {
				if (process.platform === "linux") {
					return fs.readdirSync("/proc/self/fd").flatMap(fd => {
						try {
							const target = fs.readlinkSync("/proc/self/fd/" + fd);
							return target.startsWith(canonicalFixture + path.sep) ? [target] : [];
						} catch (error) {
							if (error.code !== "ENOENT") throw error;
							return [];
						}
					});
				}
				if (process.platform === "darwin") {
					const observed = Bun.spawnSync({
						cmd: ["/usr/sbin/lsof", "-a", "-p", String(process.pid), "-Fpn"],
						stdout: "pipe", stderr: "pipe",
					});
					const records = observed.stdout.toString().split("\\n");
					if (observed.exitCode !== 0 || !records.includes("p" + process.pid)) {
						throw new Error("cannot observe owned SQLite files: " + observed.stderr.toString());
					}
					return records.filter(record => record.startsWith("n"))
						.map(record => record.slice(1))
						.filter(file => file.startsWith(canonicalFixture + path.sep));
				}
				return null;
			}
			const beforeCloseDescriptors = ownedFiles();
			closeDb();
			const sidecars = ["deck.db-wal", "deck.db-shm"].filter(name => fs.existsSync(path.join(fixture, name)));
			const descriptors = ownedFiles();
			if (descriptors?.length) throw new Error(JSON.stringify({ sidecars, descriptors }));
			fs.rmSync(fixture, { recursive: true });
			console.log("SQLITE_RELEASE_PROOF=" + JSON.stringify({
				sidecars, beforeCloseDescriptors, descriptors, removed: !fs.existsSync(fixture),
			}));
		`],
		cwd: root,
		env: { HOME: root, USERPROFILE: root, NPI_DECK_HOME: root },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	const proof = child.stdout.toString().split("\n").find(line => line.startsWith("SQLITE_RELEASE_PROOF="));
	const observed = JSON.parse(proof!.slice("SQLITE_RELEASE_PROOF=".length));
	console.info("SQLITE_RELEASE_PROOF=" + JSON.stringify(observed));
	expect(observed.descriptors).toEqual(process.platform === "linux" || process.platform === "darwin" ? [] : null);
	expect(observed.removed).toBe(true);
});
