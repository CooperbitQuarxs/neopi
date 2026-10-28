import * as fs from "node:fs";
import { nativeProcessClass } from "../src/backend/runtime.ts";

export async function observeProcessTree(marker: string) {
	for (let i = 0; i < 150 && !fs.existsSync(marker); i++) await Bun.sleep(10);
	const pids = JSON.parse(fs.readFileSync(marker, "utf8")) as Record<"shell" | "parent" | "grandchild", number>;
	const NativeProcess = nativeProcessClass();
	const references = Object.entries(pids).map(([role, pid]) => {
		const reference = NativeProcess.fromPid(pid);
		if (!reference) throw new Error(`fixture ${role} ${pid} exited before readiness observation`);
		return { role, reference };
	});
	const states = () => references.map(({ role, reference }) => ({ role, pid: reference.pid, status: reference.status() }));
	console.log(JSON.stringify({ event: "tree-ready", pids, states: states() }));
	return {
		states,
		kill: () => { for (const { reference } of references) reference.killTree(); },
	};
}

// This control must stay outside Deck ownership to detect overly broad cleanup.
export function unrelatedProcess() {
	const proc = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdout: "ignore", stderr: "ignore" });
	const reference = nativeProcessClass().fromPid(proc.pid);
	if (!reference) throw new Error("control process exited before observation");
	return {
		status: () => reference.status(),
		async close() { reference.killTree(); await proc.exited; },
	};
}
