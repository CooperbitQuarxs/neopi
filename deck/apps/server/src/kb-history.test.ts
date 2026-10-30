import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { KbService } from "./kb-service.ts";
import { buildKbRouter } from "./routes-kb.ts";
import { spawnOwnedSync, stopOwnedProcesses } from "./owned-process.ts";

let root: string;
let savedHome: string | undefined;
beforeEach(async () => {
	const scratch = join(homedir(), ".cache/npi-canary/neodeck-pool/KnowledgeCartographer/tests");
	await mkdir(scratch, { recursive: true });
	root = await mkdtemp(join(scratch, "history-"));
	savedHome = process.env.NPI_DECK_HOME;
	process.env.NPI_DECK_HOME = join(root, "deck-home");
	await writeFile(join(root, "note.md"), "# Note\n");
	await writeFile(join(root, "private.md"), "# Private\n");
	await writeFile(join(root, ".kbignore"), "private.md\n");
});
afterEach(async () => {
	await stopOwnedProcesses();
	if (savedHome === undefined) delete process.env.NPI_DECK_HOME;
	else process.env.NPI_DECK_HOME = savedHome;
	await rm(root, { recursive: true, force: true });
});

test("unversioned notes report unavailable rather than fabricated activity", async () => {
	const app = buildKbRouter(new KbService({ root }));
	const response = await app.request("/kb/history?path=note.md");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ available: false, entries: [] });
});

test("tracked notes return real commits and follow renames", async () => {
	const git = (...args: string[]) => {
		const result = spawnOwnedSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
		expect(result.exitCode).toBe(0);
		return result.stdout.toString().trim();
	};
	git("init", "-q");
	git("config", "user.name", "History Fixture");
	git("config", "user.email", "history@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("add", "note.md");
	git("commit", "-q", "-m", "Create note");
	const first = git("rev-parse", "HEAD");
	git("mv", "note.md", "renamed.md");
	git("commit", "-q", "-m", "Rename note");
	const second = git("rev-parse", "HEAD");
	const response = await buildKbRouter(new KbService({ root })).request("/kb/history?path=renamed.md");
	expect(response.status).toBe(200);
	const history = await response.json() as { available: boolean; entries: { id: string; actor: string; text: string }[] };
	expect(history.available).toBe(true);
	expect(history.entries.map(({ id, actor, text }) => ({ id, actor, text }))).toEqual([
		{ id: second, actor: "History Fixture", text: "Rename note" },
		{ id: first, actor: "History Fixture", text: "Create note" },
	]);
});

test("history respects missing, ignored, and escaping path boundaries", async () => {
	const app = buildKbRouter(new KbService({ root }));
	expect((await app.request("/kb/history")).status).toBe(400);
	for (const path of ["private.md", "missing.md", "../note.md", "/etc/passwd"]) {
		expect((await app.request(`/kb/history?path=${encodeURIComponent(path)}`)).status).toBe(404);
	}
});
