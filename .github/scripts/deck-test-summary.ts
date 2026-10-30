import * as fs from "node:fs/promises";
import { summarizeTests } from "../../deck/.github/scripts/test-summary.ts";
import { escapeAnnotation } from "../../deck/.github/scripts/typecheck.ts";

const [log, outcome] = process.argv.slice(2);
if (!log || !outcome) throw new Error("Usage: bun deck-test-summary.ts <test-log> <step-outcome>");
const report = summarizeTests(await Bun.file(log).text(), outcome, true);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report.markdown);
console.log(report.markdown);
if (report.failed) {
	console.log(`::warning title=Deck tests are informational::${escapeAnnotation(`${report.counts.fail ?? "Unknown number of"} failing tests, ${report.counts.error ?? 0} errors; see the job summary for names and the log for runner/import errors`)}`);
	for (const name of report.names) console.log(`::warning title=Failed deck test::${escapeAnnotation(name)}`);
}
