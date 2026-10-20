import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, hasFsCode, isEnoent, logger } from "@oh-my-pi/pi-utils";

const names = ["persona", "loadout", "repl", "live-persona"].flatMap(name => [`neopi-${name}`, `omomp-${name}`]);

/** Retire the former installer's links before discovery can import them. */
export async function retireManagedExtensions(agentDir: string = getAgentDir()): Promise<void> {
	const marker = Bun.file(path.join(agentDir, ".neopi-extensions-retired"));
	try {
		if (await marker.exists()) return;
		const extensionsDir = path.join(agentDir, "extensions");
		for (const name of names) {
			const entry = path.join(extensionsDir, name);
			let target: string;
			try {
				target = path.resolve(extensionsDir, await fs.readlink(entry));
			} catch (error) {
				if (isEnoent(error) || hasFsCode(error, "EINVAL")) continue;
				throw error;
			}
			// Match the old installer's target shape, even for dangling links.
			// Never follow or delete a real directory, custom link, or backup.
			if (path.basename(target) !== name || path.basename(path.dirname(target)) !== "extensions") continue;
			try {
				await fs.unlink(entry);
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
		}
		await Bun.write(marker, "1\n");
	} catch (error) {
		// Leave the marker absent so the next startup can retry.
		logger.warn("Failed to retire managed fork extensions", { agentDir, error: String(error) });
	}
}
