import * as path from "node:path";

/** Set every home selector before spawning a fixture, including Windows aliases. */
export function isolateFixtureHome(
	env: Record<string, string>,
	home: string,
	platform: NodeJS.Platform = process.platform,
): void {
	// Windows environment names are case-insensitive. Do not leave a differently
	// cased inherited profile alongside the canonical fixture values.
	for (const key of Object.keys(env)) {
		if (/^(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH)$/i.test(key)) delete env[key];
	}
	const drive = platform === "win32" ? path.win32.parse(home).root.replace(/[\\/]+$/, "") : "";
	Object.assign(env, {
		HOME: home,
		USERPROFILE: home,
		HOMEDRIVE: drive,
		HOMEPATH: home.slice(drive.length),
	});
}
