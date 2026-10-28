import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, closeDb } from "../db/index.ts";
import { initializeOwnedGeneration, stopOwnedProcesses } from "../owned-process.ts";
import { RoutinesRunner } from "../routines-runner.ts";
import { removeTestPath } from "../test-cleanup.ts";

export interface RoutineTestFixture {
	readonly home: string;
	readonly runner: RoutinesRunner;
}

// Keep the lease until the body AND teardown settle. Bun timing out a test or
// hook does not cancel its promise, so the next invocation must join it itself.
export class RoutineTestFixtures {
	#pending: Promise<void> = Promise.resolve();

	run(body: (fixture: RoutineTestFixture) => Promise<void>, agentCommand?: (home: string) => string[]): Promise<void> {
		const result = Promise.withResolvers<void>();
		const pending = this.#pending.catch(() => {}).then(async () => {
			const savedHome = process.env.NPI_DECK_HOME;
			const savedDbPath = process.env.NPI_DECK_DB_PATH;
			const savedGeneration = process.env.NPI_DECK_GEN;
			const home = fs.mkdtempSync(path.join(os.tmpdir(), "npi-routine-test-"));
			let runner: RoutinesRunner | undefined;
			try {
				process.env.NPI_DECK_HOME = home;
				process.env.NPI_DECK_DB_PATH = path.join(home, "deck.db");
				openDb({ path: process.env.NPI_DECK_DB_PATH });
				initializeOwnedGeneration();
				runner = agentCommand ? new RoutinesRunner(() => agentCommand(home)) : new RoutinesRunner();
				try {
					await body({ home, runner });
					result.resolve();
				} catch (error) {
					result.reject(error);
					throw error;
				}
			} finally {
				try {
					try { await runner?.dispose(); }
					finally { await stopOwnedProcesses(); }
				} finally {
					closeDb();
					for (const [key, value] of Object.entries({ NPI_DECK_HOME: savedHome, NPI_DECK_DB_PATH: savedDbPath, NPI_DECK_GEN: savedGeneration })) {
						if (value === undefined) delete process.env[key];
						else process.env[key] = value;
					}
					removeTestPath(home);
				}
			}
		});
		// A later admission consumes the prior rejection only after release.
		this.#pending = pending;
		// Observe setup/cleanup failures without dropping them from join().
		void pending.catch(error => result.reject(error));
		return result.promise;
	}

	join(): Promise<void> { return this.#pending; }
}
