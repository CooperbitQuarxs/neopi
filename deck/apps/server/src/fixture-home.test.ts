import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isolateFixtureHome } from "./fixture-home.ts";
import { spawnOwnedSync } from "./owned-process.ts";

test("Windows fixture homes replace inherited profile aliases and drive selectors", () => {
	const env: Record<string, string> = {
		HOME: "/owner", Home: "/other-owner", UserProfile: "C:\\Users\\owner",
		HOMEDRIVE: "C:", HomePath: "\\Users\\owner", PATH: "launch-path",
	};
	isolateFixtureHome(env, "D:\\fixtures\\home", "win32");
	expect(env).toEqual({
		HOME: "D:\\fixtures\\home", USERPROFILE: "D:\\fixtures\\home",
		HOMEDRIVE: "D:", HOMEPATH: "\\fixtures\\home", PATH: "launch-path",
	});
});

test("non-Windows fixture homes keep HOME and replace inherited Windows selectors", () => {
	const env = { HOME: "/owner", USERPROFILE: "C:\\Users\\owner", HOMEDRIVE: "C:", HOMEPATH: "\\Users\\owner" };
	isolateFixtureHome(env, "/private/home", "linux");
	expect(env).toEqual({ HOME: "/private/home", USERPROFILE: "/private/home", HOMEDRIVE: "", HOMEPATH: "/private/home" });
});

test("a spawned fixture resolves its actual home inside the private directory", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-fixture-home-"));
	try {
		const home = path.join(root, "home");
		fs.mkdirSync(home);
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC)$/i.test(key)) env[key] = value;
		}
		Object.assign(env, { HOME: "/owner", UserProfile: "C:\\Users\\owner", HOMEDRIVE: "C:", HOMEPATH: "\\Users\\owner" });
		isolateFixtureHome(env, home);
		const child = spawnOwnedSync([process.execPath, "-e", 'console.log(require("node:os").homedir())'], {
			cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
		}, { replaceEnv: true });
		expect(child.exitCode).toBe(0);
		expect(child.stderr.toString()).toBe("");
		expect(child.stdout.toString().trim()).toBe(home);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
