import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { countSessionMessages } from "@oh-my-pi/pi-natives";
import { isRecord, logger } from "@oh-my-pi/pi-utils";

function fileIdentity(stat: Stats): string {
	return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}

/** Count persisted message entries without retaining history or acquiring its writer lease. */
export async function countSessionCatalogMessages(file: string, cacheDir: string): Promise<number> {
	const before = await fs.stat(file);
	const identity = fileIdentity(before);
	const key = new Bun.CryptoHasher("sha256").update(file).digest("hex");
	const cacheFile = path.join(cacheDir, `v1-${key}.json`);
	try {
		const cached: unknown = await Bun.file(cacheFile).json();
		if (
			isRecord(cached) &&
			cached.identity === identity &&
			typeof cached.count === "number" &&
			Number.isSafeInteger(cached.count) &&
			cached.count >= 0
		) {
			return cached.count;
		}
	} catch {
		// A missing, corrupt or inaccessible cache never replaces the journal.
	}

	const count = await countSessionMessages(file, before.size);
	// Never publish a count under the identity of a concurrently changed file.
	const after = await fs.stat(file);
	if (fileIdentity(after) !== identity) return count;

	const temporary = `${cacheFile}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
		await fs.writeFile(temporary, JSON.stringify({ identity, count }), { mode: 0o600 });
		await fs.rename(temporary, cacheFile);
	} catch (error) {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
		logger.debug("Session catalog count cache write failed", { error: String(error) });
	}
	return count;
}
