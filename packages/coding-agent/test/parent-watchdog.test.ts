import { describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Process } from "@oh-my-pi/pi-natives";
import { type ParentWatchdogNatives, watchParentProcess } from "../src/utils/parent-watchdog";

const FIXTURE = path.join(import.meta.dir, "fixtures", "parent-watchdog-orphan.ts");

describe("startParentWatchdog", () => {
	// Issue #14340: an IPC worker whose main thread was pinned inside a
	// synchronous native call (onnxruntime inference) outlived its dead parent
	// as a multi-GiB PPID-1 orphan, because the parent-liveness watchdog ran on
	// that same starved event loop.
	it("kills an orphaned process whose main thread is blocked", async () => {
		const middle = Bun.spawn([process.execPath, FIXTURE], { stdout: "pipe", stderr: "inherit" });
		const childPid = Number.parseInt((await new Response(middle.stdout).text()).trim(), 10);
		await middle.exited;
		// The middle hard-killed itself after the child armed: a signal on POSIX,
		// TerminateProcess exit code 1 on Windows (the never-armed path exits 2).
		if (process.platform === "win32") expect(middle.exitCode).toBe(1);
		else expect(middle.signalCode).toBe("SIGKILL");

		const child = Process.fromPid(childPid);
		if (!child) return; // Already gone: the watchdog won the race.
		const exited = await child.waitForExit({ timeoutMs: 5_000 });
		if (!exited) child.killTree();
		expect(exited).toBe(true);
	}, 15_000);
});

describe("parent watchdog", () => {
	it.each([
		["rejects", () => Promise.reject(new Error("native wait unavailable"))],
		["returns false", () => Promise.resolve(false)],
	])("keeps watching an alive parent when the native wait %s", async (_, waitForExit) => {
		let status = "running";
		const onParentExit = vi.fn();
		const natives = {
			Process: {
				fromPid: () => ({ status: () => status, waitForExit }),
			},
			ProcessStatus: { Running: "running", Exited: "exited" },
		} as unknown as ParentWatchdogNatives;
		const watch = watchParentProcess({
			parentPid: process.ppid,
			natives,
			pollIntervalMs: 5,
			onParentExit,
		});
		try {
			await Bun.sleep(30);
			expect(onParentExit).not.toHaveBeenCalled();
			status = "exited";
			await Bun.sleep(30);
			expect(onParentExit).toHaveBeenCalledTimes(1);
		} finally {
			watch.stop();
		}
	});
});
