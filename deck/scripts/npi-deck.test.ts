import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CONFIG_EXIT_CODE, acquireLock, missingNativeRecordProblem, releaseLock, signalWorkerGroup, unresolvedDependencies } from "./npi-deck.ts";
import { processStartTime } from "../apps/server/src/owned/launcher.ts";

function lockPath(): string {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-lock-")), "launcher.lock");
}

describe.skipIf(process.platform !== "linux")("launcher lock", () => {
	test("a second launch is refused while the holder lives", async () => {
		const file = lockPath();
		const holder = Bun.spawn(["sleep", "30"], { stdout: "ignore" });
		try {
			const start = fs.readFileSync(`/proc/${holder.pid}/stat`, "utf8");
			const startTime = start.slice(start.lastIndexOf(")") + 2).split(" ")[19];
			fs.writeFileSync(file, JSON.stringify({ pid: holder.pid, startTime, unit: "npi-deck" }));

			expect(acquireLock(file, "npi-deck")).toMatchObject({ pid: holder.pid, unit: "npi-deck" });
		} finally {
			holder.kill("SIGKILL");
		}
	});

	test("a lock left by a dead launcher, or by a reused pid, is taken over", () => {
		const file = lockPath();
		fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 1, unit: "npi-deck" }));
		expect(acquireLock(file, "npi-deck")).toBeUndefined();
		expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(process.pid);
		releaseLock(file);

		// Our own pid, but a start time that is not ours: the pid was reused.
		fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startTime: "1", unit: "npi-deck" }));
		expect(acquireLock(file, "npi-deck")).toBeUndefined();
		releaseLock(file);
		expect(fs.existsSync(file)).toBe(false);
	});
});

describe("dependency check", () => {
	function workspace(dependencies: Record<string, string>): { root: string; pkg: string } {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-deps-"));
		const pkg = path.join(root, "deck", "apps", "server");
		fs.mkdirSync(pkg, { recursive: true });
		fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "server", dependencies }));
		return { root, pkg };
	}
	function install(dir: string, name: string): void {
		const target = path.join(dir, "node_modules", name);
		fs.mkdirSync(target, { recursive: true });
		fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, main: "index.js" }));
		fs.writeFileSync(path.join(target, "index.js"), "module.exports = {};");
	}

	test("dependencies hoisted to the workspace root count as installed", () => {
		const { root, pkg } = workspace({ hono: "^4", yaml: "^2" });
		install(root, "hono");
		install(root, "yaml");
		expect(fs.existsSync(path.join(root, "deck", "node_modules"))).toBe(false);
		expect(unresolvedDependencies(pkg)).toEqual([]);
	});

	test("a dependency that resolves nowhere is reported by name", () => {
		const { root, pkg } = workspace({ hono: "^4", yaml: "^2" });
		install(root, "hono");
		expect(unresolvedDependencies(pkg)).toEqual(["yaml"]);
	});

	test("a backend tree without a native addon record is refused with the command that fixes it", () => {
		const tree = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-record-"));
		const problem = missingNativeRecordProblem(tree);
		expect(problem).toContain("native-addon.ts --built");
		expect(problem).toContain("--native-dir");
		expect(problem).toContain(tree);
	});

	test("a backend tree with a native addon record is accepted", () => {
		const tree = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-record-"));
		const record = {
			variant: "modern",
			inputs: "a".repeat(64),
			platform: "linux-x64",
			sha256: "b".repeat(64),
			packageVersion: "1.0.0",
			provenance: "built",
			source: "x.node",
		};
		fs.mkdirSync(path.join(tree, "node_modules", ".npi-deck"), { recursive: true });
		fs.writeFileSync(path.join(tree, "node_modules", ".npi-deck", "native-addon.json"), JSON.stringify(record));
		expect(missingNativeRecordProblem(tree)).toBeNull();
	});

	test("configuration failures use a status the supervisor is told not to restart on", () => {
		expect(CONFIG_EXIT_CODE).toBe(78);
	});
});

test.skipIf(process.platform !== "linux")("direct launcher spares a reused worker process group", async () => {
	const worker = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore" });
	try {
		const startTime = processStartTime(worker.pid);
		expect(startTime).toBeDefined();
		signalWorkerGroup(worker.pid, "stale-starttime", "SIGTERM");
		await Bun.sleep(50);
		expect(worker.exitCode).toBeNull();
		signalWorkerGroup(worker.pid, startTime, "SIGTERM");
		await worker.exited;
		expect(worker.signalCode).not.toBeNull();
	} finally {
		if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
		await worker.exited;
	}
});
