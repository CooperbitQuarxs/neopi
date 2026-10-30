import { test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnOwnedSync } from "./owned-process.ts";
import { removeTestPath } from "./test-cleanup.ts";

const FILE_ENV = "NPI_DECK_ISOLATED_TEST_FILE";
const CASE_ENV = "NPI_DECK_ISOLATED_TEST_CASE";
const launchKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC"]);

export function isIsolatedCase(file: string): boolean {
	return process.env[FILE_ENV] === fs.realpathSync(file) && process.env[CASE_ENV] !== undefined;
}

export function runIsolatedCase(
	file: string,
	name: string,
	extraEnv: Record<string, string> = {},
): { exitCode: number; output: string; root: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "npi-deck-isolated-test-"));
	let result: { exitCode: number; output: string; root: string } | undefined;
	try {
		const home = path.join(root, "home");
		const temp = path.join(root, "tmp");
		const drive = process.platform === "win32" ? path.parse(home).root.replace(/[\\/]+$/, "") : "";
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined && launchKeys.has(key.toUpperCase())) env[key] = value;
		}
		const directories = {
			HOME: home,
			USERPROFILE: home,
			TMPDIR: temp,
			TMP: temp,
			TEMP: temp,
			APPDATA: path.join(home, "AppData", "Roaming"),
			LOCALAPPDATA: path.join(home, "AppData", "Local"),
			XDG_CONFIG_HOME: path.join(home, ".config"),
			XDG_DATA_HOME: path.join(home, ".local", "share"),
			XDG_STATE_HOME: path.join(home, ".local", "state"),
			XDG_CACHE_HOME: path.join(home, ".cache"),
			XDG_RUNTIME_DIR: path.join(root, "runtime"),
			NPI_DECK_HOME: path.join(root, "deck"),
			NPI_DECK_DEFAULT_CWD: home,
			NPI_DECK_UPLOADS_ROOT: path.join(root, "uploads"),
			NPI_DECK_KB_ROOT: path.join(root, "kb"),
			PI_CODING_AGENT_DIR: path.join(root, "agent"),
		};
		Object.assign(env, directories, {
			HOMEDRIVE: drive,
			HOMEPATH: home.slice(drive.length),
			NPI_DECK_DB_PATH: path.join(directories.NPI_DECK_HOME, "deck.db"),
			[FILE_ENV]: fs.realpathSync(file),
			[CASE_ENV]: name,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			TERM: "dumb",
		});
		const reserved = new Set(Object.keys(env).map(key => key.toUpperCase()));
		for (const [key, value] of Object.entries(extraEnv)) {
			const upper = key.toUpperCase();
			if (reserved.has(upper) || upper.startsWith("NPI_DECK_ISOLATED_TEST_") ||
				upper === "NPI_DECK_GEN" || upper === "NPI_DECK_OWNED_GROUP" ||
				/^(PI_|OMP_|BUN_|NODE_|LD_|DYLD_|XDG_)/.test(upper) ||
				/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROFILE)/.test(upper)) {
				throw new Error(`Cannot override isolated test environment variable ${key}`);
			}
			env[key] = value;
		}
		for (const directory of Object.values(directories)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		const child = spawnOwnedSync([process.execPath, "test", path.resolve(file)], {
			cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
		}, { replaceEnv: true });
		return result = { exitCode: child.exitCode, output: `${child.stdout.toString()}${child.stderr.toString()}`, root };
	} finally {
		// The private worker has exited and both streams are drained before removal.
		try { removeTestPath(root); }
		catch (error) {
			if (result) throw new AggregateError([error],
				`Isolated worker fixture cleanup failed after exit ${result.exitCode}: ${String(error)}\n${result.output}`);
			throw error;
		}
	}
}

export function createIsolatedTest(file: string, extraEnv: Record<string, string> = {}): (name: string, body: () => void | Promise<void>, timeout?: number) => void {
	const isolated = isIsolatedCase(file);
	let selected = false;
	return (name, body, timeout) => {
		if (process.env[FILE_ENV] !== undefined || process.env[CASE_ENV] !== undefined) {
			if (!isolated || name !== process.env[CASE_ENV]) return;
			if (selected) throw new Error(`Duplicate isolated test case: ${name}`);
			selected = true;
			test(name, body, timeout);
			return;
		}
		// The child retains the original case/hook deadlines. This outer envelope
		// additionally covers cold worker startup, teardown and output draining.
		test(name, () => {
			const child = runIsolatedCase(file, name, extraEnv);
			if (child.exitCode !== 0) throw new Error(`Isolated test ${JSON.stringify(name)} exited ${child.exitCode}\n${child.output}`);
			if (!/^\s*1 pass\s*$/m.test(child.output) || !/^\s*0 fail\s*$/m.test(child.output)) {
				throw new Error(`Isolated test ${JSON.stringify(name)} did not execute exactly one passing case\n${child.output}`);
			}
		}, (timeout ?? 5000) + 75_000);
	};
}
