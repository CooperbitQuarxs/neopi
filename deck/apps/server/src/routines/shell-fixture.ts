import * as fs from "node:fs";
import * as path from "node:path";

export interface ShellFixtureConfig {
	marker?: string;
	release?: string;
	bytes?: string;
	append?: boolean;
	newline?: boolean;
	exitCode?: number;
	expectedCwd?: string;
	leaderExits?: boolean;
}

/** Test-only commands for the unchanged bash -lc / cmd /c production boundary. */
export function shellFixtureCommand(
	runtime: string,
	script: string,
	mode: "write" | "hold" | "success" | "tree",
	config: ShellFixtureConfig,
	renderedValue?: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
	if (platform === "win32") {
		// Bun's default Windows argv quoting escapes embedded quotes for the CRT,
		// but cmd /c does not decode those escapes. Keep quoted paths in a batch
		// file instead; only its space-free basename crosses the spawn boundary.
		const launcher = `routine-fixture-${crypto.randomUUID()}.cmd`;
		const command = [runtime, script, mode, encoded].map(arg => `"${arg}"`).join(" ");
		const release = [runtime, script, "release", encoded].map(arg => `"${arg}"`).join(" ");
		const body = mode === "tree" && config.leaderExits
			? `start "" /b ${command}\r\n${release}\r\nexit 0`
			: command + (renderedValue === undefined ? "" : ' "%*"');
		fs.writeFileSync(path.join(path.dirname(script), launcher), `@echo off\r\n${body}\r\n`);
		// Rendered fixture values are controlled literals/templates, not shell input.
		return launcher + (renderedValue === undefined ? "" : ` ${renderedValue}`);
	}
	const args = [runtime, script, mode, encoded];
	if (renderedValue !== undefined) args.push(renderedValue);
	const quote = (arg: string) => `'${arg.replaceAll("'", "'\"'\"'")}'`;
	const command = args.map(quote).join(" ");
	if (mode === "tree" && config.leaderExits) {
		return `${command} & ${[runtime, script, "release", encoded].map(quote).join(" ")}; exit 0`;
	}
	return command + (mode === "tree" ? "; wait" : "");
}

export function createShellFixture(home: string) {
	const cwd = path.join(home, "shell fixture's cwd");
	fs.mkdirSync(cwd, { recursive: true });
	const script = path.join(cwd, "routine fixture's runtime.cjs");
	fs.copyFileSync(path.join(import.meta.dir, "shell-fixture-runtime.cjs"), script);
	return {
		cwd,
		command(mode: "write" | "hold" | "success" | "tree", config: ShellFixtureConfig = {}, renderedValue?: string): string {
			return shellFixtureCommand(process.execPath, script, mode, { ...config, expectedCwd: cwd }, renderedValue);
		},
	};
}
