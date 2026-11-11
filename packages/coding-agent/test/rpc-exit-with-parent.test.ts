/**
 * `--exit-with-parent` for RPC hosts: a host that dies or closes stdin takes the process, its running bash
 * command and its descendants with it within seconds, while the default keeps draining accepted work.
 * Spawns the CLI like the print-mode exit-with-parent contract (neopi#127).
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import { RPC_CAPABILITIES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-capabilities";
import { RPC_INPUT_CLOSED_TEARDOWN_MS } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import { TempDir } from "@oh-my-pi/pi-utils";
import { RpcChild } from "./helpers/rpc-child";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return true;
		await Bun.sleep(50);
	}
	return condition();
}

describe("--exit-with-parent for RPC", () => {
	test("is parsed, opt-in, and advertised as a capability", () => {
		expect(parseArgs(["--mode", "rpc", "--exit-with-parent"]).exitWithParent).toBe(true);
		expect(parseArgs(["--mode", "rpc"]).exitWithParent).toBeUndefined();
		expect(RPC_CAPABILITIES).toContain("exit_with_parent");
		expect(RPC_INPUT_CLOSED_TEARDOWN_MS).toBeLessThanOrEqual(10_000);
	});

	test("stdin EOF aborts a running bash command and exits within the budget, leaving no descendants", async () => {
		using dir = TempDir.createSync("@rpc-eof-");
		const pidFile = path.join(dir.path(), "sleep.pid");
		const child = await RpcChild.spawn({ args: ["--exit-with-parent"] });
		await child.waitFor(frame => frame.type === "ready");
		// A foreground command that spawns a long-lived descendant and then waits on it.
		void child.request({ type: "bash", command: `sleep 300 & echo $! > ${pidFile}; wait` }, 60_000).catch(() => {});
		expect(
			await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() !== "", 15_000),
		).toBe(true);
		const sleeper = Number(fs.readFileSync(pidFile, "utf8").trim());
		expect(alive(sleeper)).toBe(true);
		const started = Date.now();
		child.process.stdin.end();
		await child.process.exited;
		expect(Date.now() - started).toBeLessThan(RPC_INPUT_CLOSED_TEARDOWN_MS + 2_000);
		expect(await waitFor(() => !alive(sleeper), 5_000)).toBe(true);
	}, 90_000);

	test("without the flag, stdin EOF still drains accepted work", async () => {
		using dir = TempDir.createSync("@rpc-eof-default-");
		const doneFile = path.join(dir.path(), "done");
		const child = await RpcChild.spawn();
		await child.waitFor(frame => frame.type === "ready");
		const pending = child.request({ type: "bash", command: `sleep 2; echo ok > ${doneFile}` }, 60_000);
		child.process.stdin.end();
		const response = await pending;
		expect(response).toMatchObject({ type: "response", command: "bash", success: true });
		expect(fs.existsSync(doneFile)).toBe(true);
		await child.process.exited;
	}, 90_000);
});
