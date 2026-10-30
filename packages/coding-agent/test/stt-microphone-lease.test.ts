import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as runtimeDirs from "@oh-my-pi/pi-utils/dirs";
import { acquireMicrophoneLease, type MicrophoneLease } from "../src/stt/microphone-lease";

describe("microphone lease", () => {
	let runtimeDir: string;
	const leases: MicrophoneLease[] = [];
	let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;

	beforeEach(async () => {
		const scratch = path.join(os.homedir(), ".cache", "npi-canary");
		await fs.mkdir(scratch, { recursive: true });
		runtimeDir = await fs.mkdtemp(path.join(scratch, "microphone-lease-"));
		spyOn(runtimeDirs, "getGlobalDaemonRuntimeDir").mockReturnValue(runtimeDir);
	});

	afterEach(async () => {
		if (child) {
			child.kill("SIGKILL");
			await child.exited;
			child = undefined;
		}
		for (const lease of leases.splice(0)) lease.release();
		vi.restoreAllMocks();
		await fs.rm(runtimeDir, { recursive: true, force: true });
	});

	it("refuses another session in the same process", () => {
		leases.push(acquireMicrophoneLease());
		expect(() => acquireMicrophoneLease()).toThrow("Microphone is already owned by another session");
	});

	it("reacquires after release without an old release freeing the new owner", () => {
		const first = acquireMicrophoneLease();
		leases.push(first);
		first.release();
		const second = acquireMicrophoneLease();
		leases.push(second);
		first.release();
		expect(() => acquireMicrophoneLease()).toThrow("Microphone is already owned by another session");
		second.release();
		leases.push(acquireMicrophoneLease());
	});

	it("refuses a child process's native gate and recovers after its abrupt exit", async () => {
		const gatePath = path.join(runtimeDir, "microphone.lock");
		// Use the actual native gate in a short-lived child, with no fixture or audio hardware.
		const source = `
			import { FileLock } from "@oh-my-pi/pi-natives";
			const gate = FileLock.tryAcquire(${JSON.stringify(gatePath)});
			if (!gate.acquired) throw new Error("Child could not claim microphone gate");
			console.log("held");
			await Bun.sleep(60_000);
			gate.release();
		`;
		child = Bun.spawn([process.execPath, "--eval", source], {
			cwd: path.join(import.meta.dir, ".."),
			env: { ...Bun.env, BUN_BE_BUN: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		let output = "";
		const decoder = new TextDecoder();
		for await (const chunk of child.stdout) {
			output += decoder.decode(chunk, { stream: true });
			if (output.includes("held\n")) break;
		}
		if (!output.includes("held\n")) {
			throw new Error(`Child exited before holding microphone: ${await new Response(child.stderr).text()}`);
		}
		expect(() => acquireMicrophoneLease()).toThrow("Microphone is already owned by another session");
		child.kill("SIGKILL");
		await child.exited;
		child = undefined;
		leases.push(acquireMicrophoneLease());
	}, 10_000);
});
