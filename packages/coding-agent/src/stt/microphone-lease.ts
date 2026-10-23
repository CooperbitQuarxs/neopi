import * as fs from "node:fs";
import * as path from "node:path";
import { FileLock } from "@oh-my-pi/pi-natives";
import { getGlobalDaemonRuntimeDir } from "@oh-my-pi/pi-utils/dirs";

export interface MicrophoneLease {
	release(): void;
}

// Native locks may permit reentrant acquisition within one process.
let microphoneOwned = false;

/** Claim the microphone across sessions and profiles until release or process exit. */
export function acquireMicrophoneLease(): MicrophoneLease {
	if (microphoneOwned) throw new Error("Microphone is already owned by another session");

	const runtimeDir = getGlobalDaemonRuntimeDir("microphone");
	fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
	const gate = FileLock.tryAcquire(path.join(runtimeDir, "microphone.lock"));
	if (!gate.acquired) {
		gate.release();
		throw new Error("Microphone is already owned by another session");
	}

	microphoneOwned = true;
	let released = false;
	return {
		release(): void {
			if (released) return;
			// Never unlink the gate: other processes must keep locking the same inode.
			gate.release();
			microphoneOwned = false;
			released = true;
		},
	};
}
