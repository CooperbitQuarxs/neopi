import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { privateBackendTest, runPrivateBackendTest } from "./private-test.ts";
import { activeBackend, loadBackend, resolveBackendSelection, sdk } from "./runtime.ts";

if (privateBackendTest(import.meta.path)) {
	test("first load and same-tree reload retain this worker's private agent storage", async () => {
		expect(activeBackend()).toBeUndefined();
		const selection = resolveBackendSelection()!;
		const backend = await loadBackend(selection);
		const agent = sdk().getAgentDir();
		expect(agent).toBe(process.env.PI_CODING_AGENT_DIR!);
		expect(agent.startsWith(os.tmpdir() + path.sep)).toBe(true);
		expect(os.homedir()).toBe(process.env.USERPROFILE!);
		const sentinel = path.join(agent, "directory-lifetime.txt");
		fs.writeFileSync(sentinel, "still owned by this worker");
		const report = process.env.NPI_DECK_DIRECTORY_REPORT;
		if (report) {
			fs.writeFileSync(report, agent);
		} else {
			const childReport = path.join(agent, "other-worker.txt");
			// An inherited named profile must not redirect the new worker away from its private agent directory.
			const saved = process.env.OMP_PROFILE;
			try {
				process.env.OMP_PROFILE = "must-not-be-inherited";
				runPrivateBackendTest(import.meta.path, { NPI_DECK_DIRECTORY_REPORT: childReport });
			} finally {
				if (saved === undefined) delete process.env.OMP_PROFILE;
				else process.env.OMP_PROFILE = saved;
			}
			const otherAgent = fs.readFileSync(childReport, "utf8");
			expect(otherAgent).not.toBe(agent);
			expect(fs.existsSync(otherAgent)).toBe(false);
			expect(fs.readFileSync(sentinel, "utf8")).toBe("still owned by this worker");
		}
		expect(await loadBackend(selection)).toBe(backend);
		expect(sdk().getAgentDir()).toBe(agent);
		expect(fs.readFileSync(sentinel, "utf8")).toBe("still owned by this worker");
	}, 280_000);
}
