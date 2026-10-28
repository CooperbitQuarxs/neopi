import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readonlyCardCommand } from "../../deck/apps/server/src/card-workspace.ts";
import { spawnOwnedSync } from "../../deck/apps/server/src/owned-process.ts";

const temporary = process.env.RUNNER_TEMP;
if (!temporary) throw new Error("RUNNER_TEMP is required for the deck sandbox preflight");
const root = await fs.mkdtemp(path.join(await fs.realpath(temporary), "deck-sandbox-"));
try {
	const runtime = path.join(root, "runtime");
	const worktree = path.join(root, "worktree");
	await fs.mkdir(runtime);
	await fs.mkdir(worktree);
	// Use the production wrapper, including setpriv and every bwrap namespace/mount flag.
	const command = readonlyCardCommand([
		"/bin/sh", "-ec",
		'id -u; id -g; cat /proc/self/uid_map; cat /proc/self/gid_map; printf "started\\n" > "$TMPDIR/probe"',
	], worktree, runtime);
	console.log(`Sandbox startup command: ${JSON.stringify(command)}`);
	const result = spawnOwnedSync(command, {
		cwd: worktree, env: { TMPDIR: runtime }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000,
	});
	process.stdout.write(result.stdout);
	// Keep bwrap's exact stderr. A namespace denial alone does not identify AppArmor.
	process.stderr.write(result.stderr);
	if (result.exitCode !== 0 || result.signalCode) {
		throw new Error(`Deck sandbox startup failed: exit ${result.exitCode}, signal ${result.signalCode ?? "none"}. Inspect the raw bwrap stderr and kernel evidence; do not assume AppArmor caused the denial.`);
	}
	if (await Bun.file(path.join(runtime, "probe")).text() !== "started\n") {
		throw new Error("Deck sandbox did not execute its startup probe");
	}
} finally {
	await fs.rm(root, { recursive: true, force: true });
}
