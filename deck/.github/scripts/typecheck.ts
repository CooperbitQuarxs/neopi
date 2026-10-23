import { appendFileSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";

interface Diagnostic { file: string; line: number; column: number; message: string; pinned: boolean }

export function classifyTypecheck(output: string, exitCode: number, cwd: string, deckRoot: string, neopiRoot: string) {
	const paths = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path;
	const within = (root: string, file: string) => {
		const relative = paths.relative(root, file);
		return relative === "" || (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
	};
	const diagnostics: Diagnostic[] = [];
	let unlocatedError = false;
	for (const line of output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
		const match = /^(.*?)\((\d+),(\d+)\):\s*error TS\d+:\s*(.*)$/.exec(line);
		if (match) {
			const file = paths.resolve(cwd, match[1]!);
			diagnostics.push({ file, line: Number(match[2]), column: Number(match[3]), message: line,
				pinned: within(neopiRoot, file) && !within(deckRoot, file) });
		} else if (/\berror TS\d+:/.test(line)) unlocatedError = true;
	}
	const own = diagnostics.filter((diagnostic) => !diagnostic.pinned);
	const pinned = diagnostics.filter((diagnostic) => diagnostic.pinned);
	// Only a normal compiler diagnostic exit can be informational. Missing tools,
	// guard failures, signals and crashes without located diagnostics still fail.
	const pinnedOnly = (exitCode === 1 || exitCode === 2) && pinned.length > 0 && own.length === 0 && !unlocatedError;
	return { own, pinned, failed: own.length > 0 || unlocatedError || (exitCode !== 0 && !pinnedOnly) };
}

export function escapeAnnotation(text: string): string {
	return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function markdownText(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
		.replace(/[\\`*_\[\]|]/g, "\\$&");
}

async function main() {
	const root = path.resolve(import.meta.dir, "../..");
	const configFile = path.join(root, "tsconfig.neopi.json");
	const config = ts.readConfigFile(configFile, ts.sys.readFile);
	if (config.error || typeof config.config?.extends !== "string") throw new Error("Prepare tsconfig.neopi.json before CI typechecking");
	const neopiRoot = path.dirname(path.resolve(root, config.config.extends));
	const { workspaces } = await Bun.file(path.join(root, "package.json")).json() as { workspaces: string[] };
	let failed = false;
	let checked = 0;
	for (const pattern of workspaces) {
		for await (const manifest of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root, absolute: true })) {
			const pkg = await Bun.file(manifest).json();
			if (!pkg.name?.startsWith("@npi-deck/") || !pkg.scripts?.typecheck) continue;
			checked++;
			const cwd = path.dirname(manifest);
			console.log(`::group::${pkg.name} typecheck`);
			const proc = Bun.spawn([process.execPath, "run", "typecheck"], {
				cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
			]);
			process.stdout.write(stdout);
			process.stderr.write(stderr);
			console.log("::endgroup::");
			const result = classifyTypecheck(`${stdout}\n${stderr}`, exitCode, cwd, root, neopiRoot);
			failed ||= result.failed;
			const status = result.failed ? "FAIL" : "PASS";
			console.log(`${pkg.name}: ${status}, ${result.own.length} deck/unknown diagnostics, ${result.pinned.length} pinned NeoPi diagnostics, raw exit ${exitCode}`);
			for (const diagnostic of result.own) console.log(`::error::${escapeAnnotation(diagnostic.message)}`);
			for (const diagnostic of result.pinned) console.log(`::warning title=Pinned NeoPi diagnostic, informational::${escapeAnnotation(diagnostic.message)}`);
			if (result.failed && result.own.length === 0) console.log(`::error::${escapeAnnotation(`${pkg.name} typecheck failed with exit ${exitCode}; inspect compiler/guard output above`)}`);
			let summary = `### ${markdownText(pkg.name)} typecheck: ${status}\n\nRaw exit: ${exitCode}. Deck/unknown diagnostics: ${result.own.length}. Pinned NeoPi diagnostics: ${result.pinned.length}.\n\n`;
			for (const diagnostic of [...result.own, ...result.pinned]) summary += `- ${diagnostic.pinned ? "Pinned, informational" : "Failing"}: ${markdownText(diagnostic.message)}\n`;
			if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
		}
	}
	if (checked === 0) throw new Error("No workspace typecheck scripts were found");
	process.exitCode = failed ? 1 : 0;
}

if (import.meta.main) await main();
