import * as fs from "node:fs";

/** Read a copied environment with the host platform's environment-key semantics. */
export function getEnvValue(env: Readonly<NodeJS.ProcessEnv>, name: string): string | undefined {
	const value = env[name];
	if (value !== undefined || process.platform !== "win32") return value;
	const foldedName = name.toUpperCase();
	for (const key in env) {
		if (key.toUpperCase() === foldedName) return env[key];
	}
	return undefined;
}

// Keep this module free of profile, directory, and dotenv-loading dependencies:
// the CLI evaluates it before profile bootstrap mutates process.env.
function readLaunchEnv(): ReadonlyMap<string, string> | undefined {
	if (process.platform === "linux") {
		try {
			const values = new Map<string, string>();
			for (const entry of fs.readFileSync("/proc/self/environ", "utf8").split("\0")) {
				const separator = entry.indexOf("=");
				if (separator > 0) values.set(entry.slice(0, separator), entry.slice(separator + 1));
			}
			return values;
		} catch {}
	}
	if (!process.execArgv.includes("--no-env-file")) return undefined;
	const values = new Map<string, string>();
	for (const key in Bun.env) {
		const value = Bun.env[key];
		if (value !== undefined) values.set(key, value);
	}
	return values;
}

// Bun may already have autoloaded project dotenv. env.ts applies its existing
// conservative dotenv filter to the fallback; this module does not load any.
export const launchEnvValues = readLaunchEnv();
export const startupProcessEnv = launchEnvValues ? undefined : Object.freeze({ ...process.env });
export const startupCwd = process.cwd();
