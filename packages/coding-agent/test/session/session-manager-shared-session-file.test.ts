import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionInUseError } from "@oh-my-pi/pi-coding-agent/session/session-lease";
import { readSessionHeaderId } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { SessionManager, type SessionPersistenceNotice } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { FileSessionStorage, tryAcquireSessionLease } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { TempDir } from "@oh-my-pi/pi-utils";

const SESSION_MANAGER_MODULE = path.join(import.meta.dir, "../../src/session/session-manager.ts");

/** What the other process reports after each command. */
interface OtherProcessState {
	sessionFile: string;
	notices: SessionPersistenceNotice[];
	errors: string[];
}

/**
 * A second process that opens the transcript either as its exclusive writer
 * or as a read-only inspector, then accepts append/rewrite/close commands.
 */
class OtherProcess {
	readonly #child: Bun.Subprocess<"pipe", "pipe", "pipe">;
	readonly #stdout: { read(): Promise<{ done: boolean; value?: Uint8Array }> };
	#buffered = "";

	private constructor(child: Bun.Subprocess<"pipe", "pipe", "pipe">) {
		this.#child = child;
		this.#stdout = child.stdout.getReader();
	}

	static async resume(
		tempDir: TempDir,
		sessionFile: string,
		readOnly = false,
	): Promise<{ other: OtherProcess; opened: OtherProcessState }> {
		const script = tempDir.join("other-process.ts");
		await Bun.write(
			script,
			[
				`import { SessionManager } from ${JSON.stringify(SESSION_MANAGER_MODULE)};`,
				`const manager = await SessionManager.${readOnly ? "openReadOnly" : "open"}(process.argv[2], undefined, undefined, { suppressBreadcrumb: true });`,
				"const notices = [];",
				"const errors = [];",
				"manager.onPersistenceNotice(notice => notices.push(notice));",
				"manager.onPersistenceError(error => errors.push(error.message));",
				'const report = () => process.stdout.write(JSON.stringify({ sessionFile: manager.getSessionFile(), notices, errors }) + "\\n");',
				"report();",
				"for await (const line of console) {",
				'	if (line === "close") break;',
				'	if (line.startsWith("append ")) {',
				'		manager.appendMessage({ role: "user", content: line.slice("append ".length), timestamp: Date.now() });',
				"		await manager.flush();",
				'	} else if (line === "rewrite") {',
				"		await manager.rewriteEntries();",
				"	}",
				"	report();",
				"}",
				"await manager.close();",
			].join("\n"),
		);
		const other = new OtherProcess(
			// The live `process.env` (Bun.spawn defaults to the launch env), so the
			// other process meets this test's private session-owner leases.
			Bun.spawn([process.execPath, script, sessionFile], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: process.env,
			}),
		);
		return { other, opened: await other.#nextState() };
	}

	async #nextState(): Promise<OtherProcessState> {
		let newline = this.#buffered.indexOf("\n");
		while (newline === -1) {
			const { done, value } = await this.#stdout.read();
			if (done) throw new Error(`The other process exited early: ${await new Response(this.#child.stderr).text()}`);
			this.#buffered += new TextDecoder().decode(value);
			newline = this.#buffered.indexOf("\n");
		}
		const line = this.#buffered.slice(0, newline);
		this.#buffered = this.#buffered.slice(newline + 1);
		return JSON.parse(line) as OtherProcessState;
	}

	async run(command: string): Promise<OtherProcessState> {
		this.#child.stdin.write(`${command}\n`);
		this.#child.stdin.flush();
		return this.#nextState();
	}

	async close(): Promise<void> {
		this.#child.stdin.write("close\n");
		this.#child.stdin.end();
		await this.#child.exited;
	}

	/** A crash, not a clean close: the dead process never releases its claim itself. */
	async kill(): Promise<void> {
		this.#child.kill("SIGKILL");
		await this.#child.exited;
	}
}

function userTurn(content: string) {
	return { role: "user" as const, content, timestamp: Date.now() };
}

async function userTurnsIn(sessionFile: string): Promise<unknown[]> {
	const reader = await SessionManager.openReadOnly(sessionFile);
	try {
		return reader
			.getEntries()
			.flatMap(entry => (entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : []));
	} finally {
		await reader.close();
	}
}

/** Resume `sessionFile` here, append one turn, and report where it saved and what it was told. */
async function resumeAndAppend(
	sessionFile: string,
	sessionDir: string,
): Promise<{ savedTo: string | undefined; notices: SessionPersistenceNotice[] }> {
	const manager = await SessionManager.open(sessionFile, sessionDir, new FileSessionStorage(), {
		suppressBreadcrumb: true,
	});
	const notices: SessionPersistenceNotice[] = [];
	manager.onPersistenceNotice(notice => notices.push(notice));
	manager.appendMessage(userTurn("resumed here"));
	await manager.close();
	return { savedTo: manager.getSessionFile(), notices };
}

async function createSession(tempDir: TempDir): Promise<string> {
	const creator = SessionManager.create(tempDir.path(), tempDir.path(), new FileSessionStorage());
	await creator.ensureOnDisk();
	creator.appendMessage(userTurn("before"));
	const sessionFile = creator.getSessionFile();
	if (!sessionFile) throw new Error("Expected session file");
	await creator.close();
	return sessionFile;
}

function sessionFilesIn(dir: string): string[] {
	return fs
		.readdirSync(dir)
		.filter(name => name.endsWith(".jsonl"))
		.map(name => path.join(dir, name))
		.sort();
}

describe("SessionManager on a session file another omp process writes", () => {
	it("rejects another writer without moving or mixing either process's transcript", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);

		const owner = await SessionManager.open(original, tempDir.path(), new FileSessionStorage(), {
			suppressBreadcrumb: true,
		});
		owner.appendMessage(userTurn("owner 1"));
		try {
			await expect(OtherProcess.resume(tempDir, original)).rejects.toThrow("SessionInUseError");
			await owner.rewriteEntries();
			owner.appendMessage(userTurn("owner 2"));
			await owner.flush();
			expect(sessionFilesIn(tempDir.path())).toEqual([original]);
		} finally {
			await owner.close();
		}
		expect(await userTurnsIn(original)).toEqual(["before", "owner 1", "owner 2"]);
	}, 30_000);

	it("does not count a process that only opened the session as its owner", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);

		// Read-only inspection must not acquire a writer lease.
		const { other: inspector } = await OtherProcess.resume(tempDir, original, true);
		try {
			expect(await resumeAndAppend(original, tempDir.path())).toEqual({ savedTo: original, notices: [] });
		} finally {
			await inspector.close();
		}
	}, 30_000);

	it("hands the file to the next writer once its owner crashed", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);

		const { other } = await OtherProcess.resume(tempDir, original);
		await other.run("append other 1");
		await other.kill();

		expect(await resumeAndAppend(original, tempDir.path())).toEqual({ savedTo: original, notices: [] });
	}, 30_000);

	for (const [kind, link] of [
		["symlink", fs.symlinkSync],
		["hard link", fs.linkSync],
	] as const) {
		it(`keeps the file with its owner when another process resumes it through a ${kind}`, async () => {
			using tempDir = TempDir.createSync("@omp-shared-session-file-");
			const original = await createSession(tempDir);

			const { other } = await OtherProcess.resume(tempDir, original);
			try {
				await other.run("append other 1");
				const alias = path.join(tempDir.path(), "alias.jsonl");
				link(original, alias);
				if (kind === "symlink") {
					// Symlinks resolve to the owner's path lease, so a second writer
					// is rejected on open rather than diverted when it first writes.
					await expect(resumeAndAppend(alias, tempDir.path())).rejects.toThrow(SessionInUseError);
					expect(sessionFilesIn(tempDir.path())).toEqual([alias, original].sort());
				} else {
					// Hard links have distinct paths; the session-id claim still
					// diverts a contender without mixing the owner's transcript.
					const { savedTo, notices } = await resumeAndAppend(alias, tempDir.path());
					if (!savedTo) throw new Error("Expected the resumed session to save somewhere");
					expect(notices).toEqual([{ reason: "open-elsewhere", from: alias, to: savedTo }]);
					expect(await userTurnsIn(savedTo)).toContain("resumed here");
				}
			} finally {
				await other.close();
			}
			// The owner's journal holds only the owner's turns.
			expect(await userTurnsIn(original)).toEqual(["before", "other 1"]);
		}, 30_000);
	}

	it("rejects a writer through a symlink without moving or copying the owner's artifacts", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);
		// Artifacts live beside the journal's real name.
		const artifactsDir = original.slice(0, -".jsonl".length);
		fs.mkdirSync(artifactsDir, { recursive: true });
		fs.writeFileSync(path.join(artifactsDir, "1.bash.log"), "tool output");

		const { other } = await OtherProcess.resume(tempDir, original);
		try {
			await other.run("append other 1");
			const alias = path.join(tempDir.path(), "alias.jsonl");
			fs.symlinkSync(original, alias);
			await expect(resumeAndAppend(alias, tempDir.path())).rejects.toThrow(SessionInUseError);
			expect(fs.readFileSync(path.join(artifactsDir, "1.bash.log"), "utf8")).toBe("tool output");
			expect(fs.existsSync(alias.slice(0, -".jsonl".length))).toBe(false);
			expect(sessionFilesIn(tempDir.path())).toEqual([alias, original].sort());
			expect(await userTurnsIn(original)).toEqual(["before", "other 1"]);
		} finally {
			await other.close();
		}
	}, 30_000);

	for (const [destination, prepare, refusal] of [
		["a copy of this session", (source: string, target: string) => fs.copyFileSync(source, target), /writes it\./],
		[
			"another session under the same name",
			(_source: string, target: string, other: string) => fs.renameSync(other, target),
			/writes the session there/,
		],
	] as const) {
		it(`refuses to move a session onto ${destination} that another process writes, moving nothing`, async () => {
			using tempDir = TempDir.createSync("@omp-shared-session-file-");
			const srcDir = path.join(tempDir.path(), "src");
			const dstDir = path.join(tempDir.path(), "dst");
			fs.mkdirSync(srcDir);
			fs.mkdirSync(dstDir);
			const source = await createSession(tempDir);
			const movedSource = path.join(srcDir, path.basename(source));
			fs.renameSync(source, movedSource);
			const target = path.join(dstDir, path.basename(source));
			prepare(movedSource, target, await createSession(tempDir));

			const { other } = await OtherProcess.resume(tempDir, target);
			try {
				await other.run("append theirs");
				const targetBefore = fs.readFileSync(target, "utf8");
				const sourceBefore = fs.readFileSync(movedSource, "utf8");

				const ours = await SessionManager.open(movedSource, srcDir, new FileSessionStorage(), {
					suppressBreadcrumb: true,
				});
				await expect(ours.moveTo(tempDir.path(), dstDir)).rejects.toThrow(refusal);
				expect(ours.getSessionFile()).toBe(movedSource);
				await ours.close();

				expect(fs.readFileSync(target, "utf8")).toBe(targetBefore);
				expect(fs.readFileSync(movedSource, "utf8")).toBe(sourceBefore);
			} finally {
				await other.close();
			}
		}, 30_000);
	}

	it("moves over a destination nobody writes and leaves that session's lease free", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const srcDir = path.join(tempDir.path(), "src");
		const dstDir = path.join(tempDir.path(), "dst");
		fs.mkdirSync(srcDir);
		fs.mkdirSync(dstDir);
		const source = await createSession(tempDir);
		const movedSource = path.join(srcDir, path.basename(source));
		fs.renameSync(source, movedSource);
		const target = path.join(dstDir, path.basename(source));
		fs.renameSync(await createSession(tempDir), target);
		const replacedId = await readSessionHeaderId(target);
		if (!replacedId) throw new Error("Expected a session header at the destination");

		const ours = await SessionManager.open(movedSource, srcDir, new FileSessionStorage(), {
			suppressBreadcrumb: true,
		});
		await ours.moveTo(tempDir.path(), dstDir);
		expect(ours.getSessionFile()).toBe(target);
		expect(await readSessionHeaderId(target)).toBe(ours.getSessionId());
		await ours.close();
		// The destination's lease was held only while the move ran.
		const probe = tryAcquireSessionLease(replacedId);
		probe?.release();
		expect(probe).not.toBeNull();
	}, 30_000);

	it("rejects opening another writer before it can change the session's cwd", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);
		const { other } = await OtherProcess.resume(tempDir, original);
		try {
			await other.run("append theirs");
			const before = fs.readFileSync(original, "utf8");
			// The fork acquires a path lease on open, before a contender can
			// obtain a manager and attempt a cwd-changing move.
			await expect(
				SessionManager.open(original, tempDir.path(), new FileSessionStorage(), { suppressBreadcrumb: true }),
			).rejects.toThrow(SessionInUseError);
			expect(fs.readFileSync(original, "utf8")).toBe(before);
		} finally {
			await other.close();
		}
	}, 30_000);

	it("refuses to move a source path that another live session replaced since this manager opened it", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const dstDir = path.join(tempDir.path(), "dst");
		fs.mkdirSync(dstDir);
		const original = await createSession(tempDir);
		const ours = await SessionManager.open(original, tempDir.path(), new FileSessionStorage(), {
			suppressBreadcrumb: true,
		});
		// Open the replacement at its own path before moving it over ours:
		// a second writer cannot open our already-leased path.
		const replacement = await createSession(tempDir);
		const { other } = await OtherProcess.resume(tempDir, replacement);
		try {
			await other.run("append theirs");
			fs.renameSync(replacement, original);
			const before = fs.readFileSync(original, "utf8");
			await expect(ours.moveTo(tempDir.path(), dstDir)).rejects.toThrow(/holds a different session/);
			expect(fs.readFileSync(original, "utf8")).toBe(before);
			expect(fs.readdirSync(dstDir)).toEqual([]);
		} finally {
			await ours.close();
			await other.close();
		}
	}, 30_000);

	it("does not append into another session that was moved onto the path after this manager opened it", async () => {
		using tempDir = TempDir.createSync("@omp-shared-session-file-");
		const original = await createSession(tempDir);
		// Opening acquires the fork's path lease, even before the first write.
		const ours = await SessionManager.open(original, tempDir.path(), new FileSessionStorage(), {
			suppressBreadcrumb: true,
		});
		const notices: SessionPersistenceNotice[] = [];
		ours.onPersistenceNotice(notice => notices.push(notice));
		// The replacement's writer opens its own path first; renaming the
		// journal externally bypasses our path lease without sharing it.
		const replacement = await createSession(tempDir);
		const { other } = await OtherProcess.resume(tempDir, replacement);
		try {
			await other.run("append theirs");
			fs.renameSync(replacement, original);
			ours.appendMessage(userTurn("ours"));
			await ours.flush();
			expect(notices.map(n => n.reason)).toEqual(["open-elsewhere"]);
			expect(await userTurnsIn(original)).not.toContain("ours");
		} finally {
			await ours.close();
			await other.close();
		}
	}, 30_000);
});
