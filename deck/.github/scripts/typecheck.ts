import { appendFileSync } from "node:fs";
import * as path from "node:path";

export function escapeAnnotation(text: string): string {
	return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function markdownText(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
		.replace(/[\\`*_\[\]|]/g, "\\$&");
}

async function main() {
	const root = path.resolve(import.meta.dir, "../..");
	let failed = false;
	for (const workspace of ["apps/server", "apps/bridges/telegram", "packages/protocol", "apps/web"]) {
		const cwd = path.join(root, workspace);
		const args = workspace === "apps/web" ? ["-b", "--noEmit"] : ["--noEmit", "-p", "."];
		console.log(`::group::${workspace} typecheck`);
		const proc = Bun.spawn([process.execPath, "x", "--no-install", "tsc", ...args], {
			cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
		]);
		process.stdout.write(stdout);
		process.stderr.write(stderr);
		console.log("::endgroup::");
		failed ||= exitCode !== 0;
		const status = exitCode === 0 ? "PASS" : "FAIL";
		if (exitCode !== 0) console.log(`::error::${escapeAnnotation(`${workspace} typecheck failed with exit ${exitCode}; inspect compiler output above`)}`);
		if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
			`### ${markdownText(workspace)} typecheck: ${status}\n\nExit: ${exitCode}. All diagnostics fail the job.\n\n`);
	}
	process.exitCode = failed ? 1 : 0;
}

if (import.meta.main) await main();
