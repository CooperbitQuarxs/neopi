/**
 * Bounded incremental reads of a session JSONL transcript, shared by remote
 * Agent Hub viewers (collab guests and tmux monitor panes). The contract
 * mirrors the hub's local `readFileIncremental`: text from `fromByte` made of
 * complete lines only, and `newSize` as the next `fromByte`.
 */
import * as fs from "node:fs/promises";

export interface TranscriptSlice {
	text: string;
	newSize: number;
	/** Terminal read failure; callers surface it instead of retrying hot. */
	error?: string;
}

/** Error text for a single JSONL entry larger than the per-read cap. */
export function transcriptEntryTooLargeError(cap: number): string {
	return `transcript entry exceeds transcript fetch cap (${cap} bytes)`;
}

/**
 * Read at most `cap` bytes of `file` from `fromByte`, trimmed to the last
 * complete line unless the read reaches end of file. A shrunken file (rotation,
 * rewrite) returns its current size so the reader restarts from there.
 */
export async function readTranscriptSlice(file: string, fromByte: number, cap: number): Promise<TranscriptSlice> {
	const stat = await fs.stat(file);
	if (stat.size <= fromByte) return { text: "", newSize: stat.size };
	const want = Math.min(stat.size - fromByte, cap);
	const buf = Buffer.allocUnsafe(want);
	const handle = await fs.open(file, "r");
	let bytesRead: number;
	try {
		({ bytesRead } = await handle.read(buf, 0, want, fromByte));
	} finally {
		await handle.close();
	}
	let slice = buf.subarray(0, bytesRead);
	const reachedEof = fromByte + bytesRead >= stat.size;
	if (!reachedEof) {
		// Trim to the last complete JSONL line so no line or UTF-8 character is split.
		const lastNewline = slice.lastIndexOf(0x0a);
		if (lastNewline < 0) return { text: "", newSize: fromByte, error: transcriptEntryTooLargeError(cap) };
		slice = slice.subarray(0, lastNewline + 1);
	}
	return { text: slice.toString("utf-8"), newSize: reachedEof ? stat.size : fromByte + slice.byteLength };
}
