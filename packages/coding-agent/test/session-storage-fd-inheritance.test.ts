/**
 * Descriptors omp holds for its own lifetime — session/advisor transcripts and
 * the rotating log — must not reach the commands the bash tool runs.
 *
 * The bash tool executes through the natives brush shell, which `fork`/`exec`s
 * external commands and therefore hands every inheritable descriptor to them
 * (the same property pinned by `config-value-fd-inheritance.test.ts`).
 * Older Bun versions omitted `O_CLOEXEC` from `fs.open*`, allowing a command
 * — or any daemon it started — to retain a writable session handle.
 *
 * Oracle: list the child's descriptor table. `sh -c` is required — a bare `ls`
 * resolves to an in-process builtin, whose `$$` is omp itself. `dup(2)` makes a
 * control descriptor explicitly inheritable even when Bun opens files with
 * `O_CLOEXEC` by default. It runs in the same child so the assertions cannot
 * pass vacuously. /proc makes this Linux-only; the helper's flag handling is
 * covered on every platform by `packages/utils/test/fs-open.test.ts`.
 */
import { dlopen, FFIType } from "bun:ffi";
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Shell } from "@oh-my-pi/pi-natives";
import { RotatingFileSink } from "@oh-my-pi/pi-utils/logger/rotating-file";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
import { FileSessionStorage } from "../src/session/session-storage";

/** POSIX dup clears FD_CLOEXEC, independently of the runtime's open defaults. */
function openInheritableControl(filename: string): number {
	const source = fs.openSync(filename, "a");
	try {
		for (const soname of ["libc.so.6", "libc.so"]) {
			let libc;
			try {
				libc = dlopen(soname, { dup: { args: [FFIType.i32], returns: FFIType.i32 } });
			} catch {
				continue;
			}
			try {
				const fd = libc.symbols.dup(source);
				if (fd < 0) throw new Error("Could not duplicate the control descriptor");
				return fd;
			} finally {
				libc.close();
			}
		}
		throw new Error("Could not load libc to create an inheritable control descriptor");
	} finally {
		fs.closeSync(source);
	}
}

const ROOTS: string[] = [];

afterAll(async () => {
	for (const root of ROOTS) await removeWithRetries(root).catch(() => {});
});

test.skipIf(process.platform !== "linux")("bash tool children never inherit session or log descriptors", async () => {
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-session-fd-"));
	ROOTS.push(root);

	const storage = new FileSessionStorage();
	const transcript = path.join(root, "session.jsonl");
	const writer = storage.openWriter(transcript);
	await writer.append('{"type":"session_start"}\n');

	const logsDir = path.join(root, "logs");
	await fsp.mkdir(logsDir, { recursive: true });
	const logSink = new RotatingFileSink({
		directory: logsDir,
		filenamePrefix: "omp",
		filenameSuffix: String(process.pid),
		maxBytes: 1 << 20,
		maxFiles: 2,
	});
	logSink.write("entry");

	const control = path.join(root, "control.jsonl");
	const controlFd = openInheritableControl(control);

	let output = "";
	try {
		const controlFlags = /^flags:\s+(\d+)$/m.exec(await Bun.file(`/proc/self/fdinfo/${controlFd}`).text())?.[1];
		expect(controlFlags, "control descriptor flags must be observable").toBeDefined();
		expect(Number.parseInt(controlFlags as string, 8) & 0o2000000, "control descriptor must be inheritable").toBe(0);
		const result = await new Shell().run({ command: "sh -c 'ls -l /proc/$$/fd'", cwd: root }, (_err, chunk) => {
			output += chunk;
		});
		expect(result.exitCode, output).toBe(0);
	} finally {
		fs.closeSync(controlFd);
		logSink.close();
		await writer.close();
	}

	const inherited = output.split("\n").filter(line => line.includes(root));
	expect(inherited.join("\n"), "control: an inheritable descriptor must reach the child").toContain(control);
	expect(inherited.join("\n")).not.toContain(transcript);
	expect(inherited.join("\n")).not.toMatch(/omp\.[\d-]+\.\d+\.log/);
});
