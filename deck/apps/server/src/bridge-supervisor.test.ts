import { expect, spyOn, test } from "bun:test";
import { BridgeSupervisor } from "./bridge-supervisor.ts";
import * as processes from "./owned-process.ts";

test("a delayed exit from the previous bridge cannot discard its replacement", async () => {
	const exits: Array<() => void> = [];
	let pid = 100;
	const spawn = spyOn(processes, "spawnOwned").mockImplementation((_command, options) => {
		const process = { pid: ++pid, exited: Promise.resolve(0), stdout: undefined, stderr: undefined } as never;
		exits.push(() => options?.onExit?.(process, 0, null, undefined));
		return process;
	});
	const terminate = spyOn(processes, "terminateOwned").mockResolvedValue(undefined);
	const supervisor = new BridgeSupervisor([{ name: "telegram", label: "Telegram", entry: "/fixture/bridge.ts", requiredEnv: [] }]);
	try {
		const first = await supervisor.start("telegram");
		const replacement = await supervisor.restart("telegram");
		expect(replacement.pid).not.toBe(first.pid);
		exits[0]!();
		expect(supervisor.get("telegram")).toMatchObject({ status: "running", pid: replacement.pid, crashCount: 0 });
		await supervisor.stop("telegram");
		exits[1]!();
		expect(supervisor.get("telegram").status).toBe("stopped");
		expect(terminate).toHaveBeenCalledTimes(2);
	} finally { spawn.mockRestore(); terminate.mockRestore(); }
});
