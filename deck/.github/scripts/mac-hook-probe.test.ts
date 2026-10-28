import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cases, environment } = require("./mac-hook-probe.cjs");

test("the probe admits only the two original cases into private homes", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac-hook-contract-"));
	try {
		expect(cases).toEqual([
			"deadline kills shell grandchild and records timeout",
			"run-duration budget preempts a longer step deadline and its child group",
		]);
		const env = environment(root, cases[0], path.join(root, "trace"));
		expect(env.NPI_DECK_ISOLATED_TEST_CASE).toBe(cases[0]);
		expect(fs.realpathSync(env.NPI_DECK_ISOLATED_TEST_FILE)).toBe(fs.realpathSync("apps/server/src/routines/foundations.test.ts"));
		expect(env.HOME).toBe(path.join(root, "home"));
		expect(env.NPI_DECK_DB_PATH).toBe(path.join(root, "deck/deck.db"));
		expect(fs.statSync(env.PI_CODING_AGENT_DIR).isDirectory()).toBe(true);
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.NPI_DECK_GEN).toBeUndefined();
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("native observers preserve abort, leader exit, output and EOF", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac-hook-native-"));
	try {
		const trace = path.join(root, "trace.jsonl");
		const child = Bun.spawn([process.execPath, "--preload", path.resolve(".github/scripts/mac-hook-preload.cjs"), "-e", `
const p = Bun.spawn({cmd: ['/bin/sh', '-c', 'printf observed; sleep 1; # sleep 30 & echo $!'], stdout: 'pipe', stderr: 'pipe'});
const a = new AbortController(); a.abort('probe-contract');
setTimeout(() => p.kill('SIGTERM'), 50);
async function drain(s) { const r = s.getReader(); let text = ''; while (true) { const v = await r.read(); if (v.done) return text; text += new TextDecoder().decode(v.value); } }
const [out, err, code] = await Promise.all([drain(p.stdout), drain(p.stderr), p.exited]);
if (out !== 'observed' || err !== '' || code === 0) process.exit(2);
`], { env: { PATH: process.env.PATH, HOME: root, NPI_DECK_HOME: root, MAC_HOOK_TRACE: trace }, stdout: "pipe", stderr: "pipe" });
		const stderr = new Response(child.stderr).text();
		expect(await child.exited).toBe(0);
		expect(await stderr).toBe("");
		const events = fs.readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
		expect(events.some(event => event.event === "abort" && event.reason === "probe-contract")).toBe(true);
		expect(events.some(event => event.event === "leader-exited" && event.code !== 0)).toBe(true);
		expect(events.some(event => event.event === "signal-call" && event.signal === "SIGTERM")).toBe(true);
		for (const stream of ["stdout", "stderr"]) {
			expect(events.some(event => event.event === "EOF" && event.stream === stream)).toBe(true);
			expect(events.some(event => event.event === "reader-closed" && event.stream === stream)).toBe(true);
		}
		expect(events.some(event => event.event === "ownership-journal")).toBe(true);
		expect(events.some(event => event.event === "writer-endpoints")).toBe(true);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
