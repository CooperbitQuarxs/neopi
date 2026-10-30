import { test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isolateFixtureHome } from "../fixture-home.ts";
import { spawnOwnedSync } from "../owned-process.ts";
import { removeTestPath } from "../test-cleanup.ts";
import { resolveBackendSelection } from "./runtime.ts";

/** Resolve only in the parent. The real SDK is first imported by the private child. */
export function runPrivateBackendTest(file: string, extraEnv: Record<string, string> = {}): void {
	const selection = resolveBackendSelection();
	if (!selection) throw new Error(`${path.basename(file)} requires a configured NeoPi backend`);
	const scratch = os.tmpdir();
	const root = fs.mkdtempSync(path.join(scratch, "deck-backend-test-"));
	try {
		const home = path.join(root, "home");
		const agent = path.join(root, "agent");
		fs.mkdirSync(home);
		fs.mkdirSync(agent);
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined && !/(_API_KEY|_TOKEN|_SECRET)$/i.test(key) && !/^(PI_|OMP_|NPI_DECK_|XDG_)/i.test(key) && !/^(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TMPDIR|TMP|TEMP)$/i.test(key)) env[key] = value;
		}
		isolateFixtureHome(env, home);
		Object.assign(env, {
			XDG_CONFIG_HOME: path.join(home, ".config"),
			XDG_DATA_HOME: path.join(home, ".local/share"),
			XDG_STATE_HOME: path.join(home, ".local/state"),
			XDG_CACHE_HOME: path.join(home, ".cache"),
			XDG_RUNTIME_DIR: path.join(root, "run"),
			TMPDIR: root, TMP: root, TEMP: root,
			PI_CODING_AGENT_DIR: agent, PI_PROFILE: "default",
			NPI_DECK_HOME: path.join(root, "deck"),
			NPI_DECK_DB_PATH: path.join(root, "deck.db"),
			NPI_DECK_BACKEND: selection.path,
			NPI_DECK_PRIVATE_TEST_FILE: file,
			OPENROUTER_API_KEY: "sk-or-private-test-dummy",
			...extraEnv,
		});
		const report = path.join(root, "results.xml");
		const child = spawnOwnedSync([process.execPath, "test", "--reporter=junit", `--reporter-outfile=${report}`, file], {
			cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 240_000,
		}, { replaceEnv: true });
		const output = `${child.stdout.toString()}${child.stderr.toString()}`;
		process.stderr.write(output);
		if (fs.existsSync(report)) process.stderr.write(fs.readFileSync(report, "utf8"));
		if (child.exitCode !== 0) throw new Error(`${path.basename(file)} child exited ${child.exitCode}`);
		if (!/\b[1-9]\d* pass\b/.test(output) || !/\b0 fail\b/.test(output)) {
			throw new Error(`${path.basename(file)} child did not execute passing behavioral tests`);
		}
	} finally {
		// spawnOwnedSync has joined the worker and drained both output streams.
		removeTestPath(root);
	}
}

/** Keep discovery in the parent, but register every original case only in its child. */
export function privateBackendTest(file: string): boolean {
	if (process.env.NPI_DECK_PRIVATE_TEST_FILE === file) return true;
	test(`${path.basename(file)} behavioral tests in a private backend process`, () => runPrivateBackendTest(file), 300_000);
	return false;
}
