import { afterEach, beforeEach, expect, spyOn, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { retireManagedExtensions } from "../src/neopi/retire-extensions";

let dir: string;
let extensions: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "neopi-retire-extensions-"));
	extensions = path.join(dir, "agent/extensions");
	await fs.mkdir(extensions, { recursive: true });
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(dir, { recursive: true, force: true });
});

test("startup succeeds with no extensions directory and records completion", async () => {
	await fs.rmdir(extensions);
	await expect(retireManagedExtensions(path.join(dir, "agent"))).resolves.toBeUndefined();
	expect(await Bun.file(path.join(dir, "agent/.neopi-extensions-retired")).text()).toBe("1\n");
});

test("filesystem failure logs without rejecting startup and remains retryable", async () => {
	const warning = spyOn(logger, "warn").mockImplementation(() => {});
	await fs.rmdir(extensions);
	await Bun.write(extensions, "not a directory");
	await expect(retireManagedExtensions(path.join(dir, "agent"))).resolves.toBeUndefined();
	expect(warning).toHaveBeenCalledTimes(1);
	expect(warning.mock.calls[0]?.[0]).toBe("Failed to retire managed fork extensions");
	expect(await Bun.file(path.join(dir, "agent/.neopi-extensions-retired")).exists()).toBe(false);
	await fs.unlink(extensions);
	await fs.mkdir(extensions);
	await fs.symlink(path.join(dir, "old/extensions/neopi-persona"), path.join(extensions, "neopi-persona"));
	await retireManagedExtensions(path.join(dir, "agent"));
	expect(await fs.readdir(extensions)).toEqual([]);
});

test("startup retires managed absolute, relative, dangling and legacy links only", async () => {
	const old = path.join(dir, "old-checkout/extensions");
	await fs.mkdir(path.join(old, "neopi-persona"), { recursive: true });
	await fs.symlink(path.join(old, "neopi-persona"), path.join(extensions, "neopi-persona"));
	await fs.symlink("../../old-checkout/extensions/neopi-repl", path.join(extensions, "neopi-repl"));
	await fs.symlink(path.join(old, "omomp-persona"), path.join(extensions, "omomp-persona"));
	await fs.symlink(path.join(dir, "custom-loadout"), path.join(extensions, "neopi-loadout"));
	await fs.symlink(path.join(old, "neopi-live-persona"), path.join(extensions, "unrelated"));
	await fs.mkdir(path.join(extensions, "neopi-live-persona"));
	await fs.mkdir(path.join(extensions, "neopi-persona.backup"));
	await Bun.write(path.join(extensions, "omomp-repl"), "operator-owned file");
	await Bun.write(path.join(extensions, ".neopi-persona.quarantined"), "operator marker");
	const state = '{"schemaVersion":1,"personas":{},"activeBySession":{"saved":"reviewer"}}';
	await Bun.write(path.join(dir, "agent/neopi-persona.json"), state);

	await retireManagedExtensions(path.join(dir, "agent"));

	expect((await fs.readdir(extensions)).sort()).toEqual([
		".neopi-persona.quarantined",
		"neopi-live-persona",
		"neopi-loadout",
		"neopi-persona.backup",
		"omomp-repl",
		"unrelated",
	]);
	expect(await fs.readlink(path.join(extensions, "neopi-loadout"))).toBe(path.join(dir, "custom-loadout"));
	expect(await Bun.file(path.join(extensions, "omomp-repl")).text()).toBe("operator-owned file");
	expect(await Bun.file(path.join(dir, "agent/neopi-persona.json")).text()).toBe(state);
});

test("completed migration does not remove links an operator adds later", async () => {
	await retireManagedExtensions(path.join(dir, "agent"));
	const target = path.join(dir, "old/extensions/neopi-persona");
	const entry = path.join(extensions, "neopi-persona");
	await fs.symlink(target, entry);
	await retireManagedExtensions(path.join(dir, "agent"));
	expect(await fs.readlink(entry)).toBe(target);
});

test("extension discovery retires links before attempting to import their code", async () => {
	const target = path.join(dir, "old/extensions/neopi-persona");
	await Bun.write(path.join(target, "index.ts"), 'throw new Error("retired extension was imported");');
	await fs.symlink(target, path.join(extensions, "neopi-persona"));
	const loader = path.resolve(import.meta.dir, "../src/extensibility/extensions/loader.ts");
	const probe = path.join(dir, "probe.ts");
	await Bun.write(
		probe,
		`import { discoverAndLoadExtensions } from ${JSON.stringify(loader)};\nconst result = await discoverAndLoadExtensions([], process.cwd());\nif (result.errors.length || result.extensions.length) throw new Error(JSON.stringify(result.errors));\n`,
	);
	const child = Bun.spawn([process.execPath, probe], {
		cwd: dir,
		env: {
			...process.env,
			HOME: dir,
			XDG_CONFIG_HOME: path.join(dir, "config"),
			PI_CODING_AGENT_DIR: path.join(dir, "agent"),
			OMP_PROFILE: "",
			PI_PROFILE: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	expect(code, stderr).toBe(0);
	expect(await fs.readdir(extensions)).toEqual([]);
}, 30_000);
