import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const temporary: string[] = [];
afterEach(async () => {
	for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function command(cwd: string, args: string[], env = process.env): Promise<string> {
	const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(code, stdout + stderr).toBe(0);
	return stdout;
}

test("source installation retires only known managed extension symlinks", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "neopi-install-"));
	temporary.push(dir);
	await Bun.write(path.join(dir, "install.sh"), Bun.file(path.join(root, "install.sh")));
	await Bun.write(path.join(dir, "scripts/npi-build-lib.sh"), Bun.file(path.join(root, "scripts/npi-build-lib.sh")));
	await Bun.write(path.join(dir, "packages/coding-agent/package.json"), '{"version":"1.0.0"}');
	const binary = path.join(dir, "packages/coding-agent/dist/npi");
	await Bun.write(binary, '#!/bin/sh\n[ "$1" != --version ] || echo npi/1.0.0\nexit 0\n');
	await fs.chmod(binary, 0o755);
	await Bun.write(path.join(dir, ".gitignore"), "node_modules\npackages/coding-agent/dist/\n");
	await fs.symlink(path.join(root, "node_modules"), path.join(dir, "node_modules"));
	await command(dir, ["git", "init", "--quiet"]);
	await command(dir, ["git", "add", "."]);
	await command(dir, [
		"git",
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	]);
	const agent = path.join(dir, "agent");
	const extensions = path.join(agent, "extensions");
	await fs.mkdir(extensions, { recursive: true });
	const old = path.join(dir, "old-checkout/extensions");
	await fs.mkdir(path.join(old, "neopi-persona"), { recursive: true });
	await fs.symlink(path.join(old, "neopi-persona"), path.join(extensions, "neopi-persona"));
	await fs.symlink(path.join(old, "neopi-repl"), path.join(extensions, "neopi-repl"));
	await fs.symlink(path.join(old, "omomp-persona"), path.join(extensions, "omomp-persona"));
	await fs.symlink(path.join(dir, "custom-loadout"), path.join(extensions, "neopi-loadout"));
	await fs.symlink(path.join(old, "neopi-live-persona"), path.join(extensions, "unrelated"));
	await fs.mkdir(path.join(extensions, "neopi-live-persona"));
	await Bun.write(path.join(extensions, "omomp-repl"), "operator-owned file");
	// Stamp after fixture setup: source_id includes untracked fixture files.
	const finalStamp = await command(dir, [
		"bash",
		"-c",
		'source scripts/npi-build-lib.sh; source_id; sha256sum packages/coding-agent/dist/npi | cut -d" " -f1',
	]);
	await Bun.write(`${binary}.source`, finalStamp.trimEnd());
	await command(dir, ["bash", "install.sh"], {
		...process.env,
		HOME: dir,
		PI_CODING_AGENT_DIR: agent,
		OMP_PROFILE: "ignored",
		PI_PROFILE: "ignored",
		NPI_DEST: path.join(dir, "bin/npi"),
	});
	expect((await fs.readdir(extensions)).sort()).toEqual([
		"neopi-live-persona",
		"neopi-loadout",
		"omomp-repl",
		"unrelated",
	]);
	expect(await fs.readlink(path.join(extensions, "neopi-loadout"))).toBe(path.join(dir, "custom-loadout"));
	expect(await Bun.file(path.join(extensions, "omomp-repl")).text()).toBe("operator-owned file");
}, 30_000);
