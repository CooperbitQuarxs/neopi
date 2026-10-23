import { appendFileSync } from "node:fs";
import { escapeAnnotation, markdownText } from "./typecheck.ts";

export function summarizeTests(output: string, outcome: string) {
	const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
	const counts: Record<string, number> = {};
	for (const match of clean.matchAll(/^\s*(\d+)\s+(pass|fail|skip|errors?)\b.*$/gm)) {
		counts[match[2] === "errors" ? "error" : match[2]!] = Number(match[1]);
	}
	const names = [...new Set([...clean.matchAll(/^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+(?:ms|s)\])?\s*$/gm)].map((match) => match[1]!.trim()))];
	const failed = outcome === "failure" || (counts.fail ?? 0) > 0 || (counts.error ?? 0) > 0;
	let markdown = `## Tests: ${failed ? "FAILED" : outcome.toUpperCase()}\n\n`;
	markdown += `Outcome: ${markdownText(outcome)}. Passed: ${counts.pass ?? "unavailable"}. Failed: ${counts.fail ?? "unavailable"}. Skipped: ${counts.skip ?? 0}. Errors: ${counts.error ?? 0}.\n\n`;
	if (failed) markdown += "Nightly test failures are informational, not a passing test result. PRs and stable builds still fail on test errors.\n\n";
	for (const name of names) markdown += `- ${markdownText(name)}\n`;
	if (failed && names.length === 0) markdown += "No failed test names were emitted. Inspect the test log for setup, import or runner errors.\n";
	return { counts, names, failed, markdown };
}

if (import.meta.main) {
	const [log, outcome] = process.argv.slice(2);
	if (!log || !outcome) throw new Error("Usage: bun test-summary.ts <test-log> <step-outcome>");
	const report = summarizeTests(await Bun.file(log).text(), outcome);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);
	console.log(report.markdown);
	if (report.failed) {
		console.log(`::warning title=Test run failed::${escapeAnnotation(`${report.counts.fail ?? "Unknown number of"} failing tests, ${report.counts.error ?? 0} errors; see the job summary for names`)}`);
		for (const name of report.names) console.log(`::warning title=Failed test::${escapeAnnotation(name)}`);
	}
}
