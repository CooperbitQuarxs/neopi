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
 *
 * When the next entry alone is longer than `cap`, it is returned whole as long
 * as it fits in `maxEntryBytes` (default `cap`), so one large record does not
 * stop the reader; an entry still being written returns no text until its line
 * ends. Only an entry beyond `maxEntryBytes` is the oversized-entry error.
 */
export async function readTranscriptSlice(
	file: string,
	fromByte: number,
	cap: number,
	maxEntryBytes = cap,
): Promise<TranscriptSlice> {
	const stat = await fs.stat(file);
	if (stat.size <= fromByte) return { text: "", newSize: stat.size };
	const handle = await fs.open(file, "r");
	try {
		const read = async (length: number): Promise<Buffer> => {
			const buf = Buffer.allocUnsafe(Math.min(stat.size - fromByte, length));
			const { bytesRead } = await handle.read(buf, 0, buf.byteLength, fromByte);
			return buf.subarray(0, bytesRead);
		};
		const slice = await read(cap);
		if (fromByte + slice.byteLength >= stat.size) return { text: slice.toString("utf-8"), newSize: stat.size };
		// Trim to the last complete JSONL line so no line or UTF-8 character is split.
		const lastNewline = slice.lastIndexOf(0x0a);
		if (lastNewline >= 0) {
			return { text: slice.subarray(0, lastNewline + 1).toString("utf-8"), newSize: fromByte + lastNewline + 1 };
		}
		if (maxEntryBytes <= cap) return { text: "", newSize: fromByte, error: transcriptEntryTooLargeError(cap) };
		// One entry longer than `cap`: serve exactly that line, whole.
		const entry = await read(maxEntryBytes);
		const end = entry.indexOf(0x0a, slice.byteLength);
		if (end >= 0) return { text: entry.subarray(0, end + 1).toString("utf-8"), newSize: fromByte + end + 1 };
		if (fromByte + entry.byteLength >= stat.size) return { text: "", newSize: fromByte };
		return { text: "", newSize: fromByte, error: transcriptEntryTooLargeError(maxEntryBytes) };
	} finally {
		await handle.close();
	}
}
