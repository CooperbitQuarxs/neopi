import * as fs from "node:fs";

/** Call only after fixture children, database connections and watchers have stopped. */
export function removeTestPath(target: string): void {
	let entry: fs.Stats;
	try {
		entry = fs.lstatSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	// Bun on Windows rejects bare rmSync(directorySymlink) with EFAULT. Unlink
	// the entry itself, including dangling links, without traversing its target.
	if (entry.isSymbolicLink()) fs.unlinkSync(target);
	else fs.rmSync(target, { recursive: true, force: true });
}

/** Restore the shared directory before removing the test's replacement link. */
export async function withTestDirectorySymlink(
	directory: string,
	target: string,
	body: () => Promise<void>,
): Promise<void> {
	const parked = `${directory}.parked-${crypto.randomUUID()}`;
	const discarded = `${directory}.link-${crypto.randomUUID()}`;
	fs.renameSync(directory, parked);
	let linked = false;
	try {
		fs.symlinkSync(target, directory, "dir");
		linked = true;
		await body();
	} finally {
		if (linked) fs.renameSync(directory, discarded);
		fs.renameSync(parked, directory);
		// A cleanup error still fails this test, but cannot leave the next test
		// looking through a dangling link when its target is removed.
		if (linked) removeTestPath(discarded);
	}
}
