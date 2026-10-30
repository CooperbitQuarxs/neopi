import type { RoutineActionKind } from "@npi-deck/protocol";
import { spawnOwned, terminateOwned } from "../owned-process.ts";
import { routineAgentCommand } from "./agent-command.ts";

const MAX_EXCERPT = 8 * 1024;
const MAX_RUNTIME_MS = 10 * 60_000;

/** Exact single-process contract shared by original V0 rows and native process nodes. */
export async function runV0Action(
	kind: RoutineActionKind,
	body: string,
	cwd: string,
	signal: AbortSignal,
): Promise<{ exitCode?: number; stdoutExcerpt: string; stderrExcerpt: string; error?: string }> {
	const cmd = buildV0Cmd(kind, body);
	if (!cmd) return { error: `unsupported action kind: ${kind}`, stdoutExcerpt: "", stderrExcerpt: "" };
	const proc = spawnOwned(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
	const onAbort = () => { void terminateOwned(proc); };
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();
	const timer = setTimeout(() => { void terminateOwned(proc); }, MAX_RUNTIME_MS);
	timer.unref?.();
	const [stdout, stderr, exitCode] = await Promise.all([readClipped(proc.stdout), readClipped(proc.stderr), proc.exited]);
	clearTimeout(timer);
	signal.removeEventListener("abort", onAbort);
	return { exitCode: typeof exitCode === "number" ? exitCode : undefined, stdoutExcerpt: stdout, stderrExcerpt: stderr };
}

function buildV0Cmd(kind: RoutineActionKind, body: string): string[] | null {
	switch (kind) {
		case "bash": return process.platform === "win32" ? ["cmd", "/c", body] : ["bash", "-lc", body];
		case "script": {
			const parts = body.trim().split(/\s+/);
			return parts[0] ? parts : null;
		}
		case "prompt": return routineAgentCommand(["-p", body]);
		default: return null;
	}
}

async function readClipped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
	if (!stream) return "";
	const reader = stream.getReader();
	const decoder = new TextDecoder("utf-8");
	let acc = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		acc += decoder.decode(value, { stream: true });
		if (acc.length > MAX_EXCERPT) {
			acc = acc.slice(0, MAX_EXCERPT) + "\n…(truncated)";
			try { await reader.cancel(); } catch { /* Original V0 behavior. */ }
			break;
		}
	}
	acc += decoder.decode();
	return acc;
}
