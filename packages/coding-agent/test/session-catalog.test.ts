import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listSessionCatalog, readSessionCatalog } from "../src/cli/sessions-cli";
import { publishControlEndpoint } from "../src/control/registry";
import { sessionDirForCwd } from "../src/session/session-paths";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "npi-catalog-"));
	roots.push(root);
	const cwd = path.join(root, "project");
	await fs.mkdir(cwd);
	return {
		root,
		cwd,
		sessionsRoot: path.join(root, "sessions"),
		agentDir: path.join(root, "agent"),
		controlRegistry: { dir: path.join(root, "control") },
	};
}
async function session(
	dir: string,
	id: string,
	cwd: string,
	content: object[] = [{ role: "user", content: "hello", timestamp: 1_780_000_000_000 }],
) {
	const file = path.join(dir, `${id}.jsonl`);
	const entries = [
		{ type: "session", version: 3, id, cwd, timestamp: "2026-06-01T00:00:00.000Z" },
		...content.map((message, index) => ({
			type: "message",
			id: `m${index}`,
			parentId: index ? `m${index - 1}` : null,
			timestamp: "2026-06-01T00:00:00.000Z",
			message,
		})),
	];
	await Bun.write(file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	return file;
}

describe("read-only session catalog", () => {
	test("project, explicit directory and all scopes share picker filtering without repairing files", async () => {
		const f = await fixture();
		await session(sessionDirForCwd(f.cwd, f.sessionsRoot), "local", f.cwd);
		await session(sessionDirForCwd(path.join(f.root, "other"), f.sessionsRoot), "other", "/other");
		const isolated = path.join(f.root, "isolated");
		await session(isolated, "isolated", f.cwd);
		await session(isolated, "empty", f.cwd, []);
		await session(isolated, "pinned", f.cwd, []);
		await Bun.write(path.join(f.agentDir, "session-pins.json"), JSON.stringify(["pinned"]));
		await Bun.write(path.join(isolated, "broken.jsonl.bak"), "do not recover me");
		const before = (await fs.readdir(isolated)).sort();
		expect((await listSessionCatalog(f)).sessions.map(s => s.id)).toEqual(["local"]);
		expect((await listSessionCatalog({ ...f, all: true })).sessions.map(s => s.id).sort()).toEqual([
			"local",
			"other",
		]);
		expect(
			(await listSessionCatalog({ ...f, sessionDirs: [isolated, isolated] })).sessions.map(s => s.id).sort(),
		).toEqual(["isolated", "pinned"]);
		expect((await fs.readdir(isolated)).sort()).toEqual(before);
		const nonexistent = path.join(f.root, "missing");
		expect((await listSessionCatalog({ ...f, sessionDirs: [nonexistent] })).sessions).toEqual([]);
		expect(await Bun.file(nonexistent).exists()).toBe(false);
	});

	test("lists missing and malformed creation timestamps alongside valid sessions", async () => {
		const f = await fixture();
		const dir = sessionDirForCwd(f.cwd, f.sessionsRoot);
		await session(dir, "valid", f.cwd);
		for (const timestamp of [undefined, "not-a-date"]) {
			const id = timestamp === undefined ? "missing" : "malformed";
			const file = await session(dir, id, f.cwd);
			const lines = (await Bun.file(file).text()).trim().split("\n");
			const header = JSON.parse(lines[0]) as Record<string, unknown>;
			header.timestamp = timestamp;
			lines[0] = JSON.stringify(header);
			await Bun.write(file, `${lines.join("\n")}\n`);
		}
		const rows = (await listSessionCatalog(f)).sessions;
		expect(rows.map(row => row.id).sort()).toEqual(["malformed", "missing", "valid"]);
		for (const row of rows) {
			expect(row.created).toBe(row.id === "valid" ? "2026-06-01T00:00:00.000Z" : row.modified);
			expect(Number.isFinite(Date.parse(row.created!))).toBe(true);
		}
	});

	test("reports a live external lease and matches control publication through a realpath alias", async () => {
		const f = await fixture();
		const dir = path.join(f.root, "isolated");
		const file = await session(dir, "busy", f.cwd);
		const alias = path.join(f.root, "alias");
		await fs.symlink(dir, alias);
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`import { acquireSessionLease } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/session/session-lease.ts"))}; const lease = acquireSessionLease(process.argv[1]); process.stdout.write("ready\\n"); await Bun.stdin.text(); lease.release();`,
				file,
			],
			{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		const reader = child.stdout.getReader();
		let publication;
		try {
			expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");
			publication = await publishControlEndpoint({
				dir: f.controlRegistry.dir,
				role: "tui",
				instanceId: "abcdef0123456789",
				imageId: "test",
				execPath: process.execPath,
				gitSha: null,
				profile: null,
				sessionId: "busy",
				sessionFile: path.join(alias, "busy.jsonl"),
				title: null,
				cwd: f.cwd,
				tmuxPane: null,
				tmuxSession: null,
				tmuxWindow: null,
				tty: null,
				onConnection: socket => socket.destroy(),
			});
			const listed = (await listSessionCatalog({ ...f, sessionDirs: [dir] })).sessions;
			expect(listed[0]?.inUse).toEqual({ pid: child.pid });
			expect(listed[0]?.control).toEqual({ instanceId: "abcdef0123456789", role: "tui", pid: process.pid });
			// Reading the transcript does not compete for or release the owner's lease.
			expect((await readSessionCatalog(file)).messages).toHaveLength(1);
			expect((await listSessionCatalog({ ...f, sessionDirs: [dir] })).sessions[0]?.inUse).toEqual({
				pid: child.pid,
			});
		} finally {
			reader.releaseLock();
			child.stdin.end();
			await child.exited;
			await publication?.close();
		}
		expect((await listSessionCatalog({ ...f, sessionDirs: [dir] })).sessions[0]?.inUse).toBeNull();
		expect((await listSessionCatalog({ ...f, sessionDirs: [dir] })).sessions[0]?.control).toBeNull();
	});

	test("read keeps visible user/assistant text, omits tools and thinking, and caps the tail", async () => {
		const f = await fixture();
		const file = await session(path.join(f.root, "isolated"), "transcript", f.cwd, [
			{ role: "user", content: "question", timestamp: 1_780_000_000_000 },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "toolCall", id: "t", name: "read", arguments: {} },
				],
				timestamp: 1_780_000_001_000,
				stopReason: "toolUse",
			},
			{
				role: "toolResult",
				toolCallId: "t",
				toolName: "read",
				content: [{ type: "text", text: "secret tool output" }],
				isError: false,
				timestamp: 1_780_000_002_000,
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "first" },
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "second" },
				],
				timestamp: 1_780_000_003_000,
				stopReason: "stop",
			},
		]);
		const before = (await fs.readdir(path.dirname(file))).sort();
		const full = await readSessionCatalog(file);
		expect(full.messages).toEqual([
			{ role: "user", text: "question", timestamp: new Date(1_780_000_000_000).toISOString() },
			{ role: "assistant", text: "first\n\nsecond", timestamp: new Date(1_780_000_003_000).toISOString() },
		]);
		expect(full.truncated).toBe(false);
		const tail = await readSessionCatalog(file, 1);
		expect(tail.messages).toEqual(full.messages.slice(-1));
		expect(tail.truncated).toBe(true);
		expect((await readSessionCatalog(file, 0)).messages).toEqual([]);
		expect((await fs.readdir(path.dirname(file))).sort()).toEqual(before);
		await expect(readSessionCatalog(file, -1)).rejects.toThrow("nonnegative integer");
	});
	test("CLI emits JSON documents and machine-readable errors with an isolated control registry", async () => {
		const f = await fixture();
		const dir = path.join(f.root, "isolated");
		const file = await session(dir, "cli", f.cwd);
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: f.agentDir,
			PI_CONTROL_DIR: f.controlRegistry.dir,
			OMP_PROFILE: "",
			PI_PROFILE: "",
		};
		const run = async (args: string[]) => {
			const child = Bun.spawn(
				[process.execPath, path.resolve(import.meta.dir, "../src/cli.ts"), "sessions", ...args],
				{ env, stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { stdout, stderr, code };
		};
		const listed = await run(["list", "--json", "--session-dir", dir]);
		expect(listed.code).toBe(0);
		expect(JSON.parse(listed.stdout).sessions[0]).toMatchObject({
			id: "cli",
			path: file,
			inUse: null,
			control: null,
		});
		const read = await run(["read", "--json", file, "--max-messages", "0"]);
		expect(read.code).toBe(0);
		expect(JSON.parse(read.stdout)).toMatchObject({ version: 1, messages: [], truncated: true });
		const missing = await run(["read", "--json", path.join(dir, "missing.jsonl")]);
		expect(missing.code).toBe(1);
		expect(missing.stdout).toBe("");
		expect(JSON.parse(missing.stderr)).toMatchObject({ type: "error", code: "session_catalog_error" });
	});
});
