import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentTranscriptSource } from "@oh-my-pi/pi-coding-agent/modes/agent-hub-runtime";
import { BlobStore } from "@oh-my-pi/pi-coding-agent/session/blob-store";
import { getBlobsDir, getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";

// Persistence moves large images into the blob store and leaves a
// `blob:sha256:` ref in the JSONL. The file-backed transcript viewer (Agent Hub
// rows without a live session, and every /monitor pane) parses that JSONL
// through agentTranscriptSource, so it must put the image bytes back or the
// Image component gets the ref text and draws a wrong-size text placeholder.
describe("agentTranscriptSource image blobs", () => {
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-hub-blobs-"));
		setAgentDir(path.join(root, "agent"));
	});

	afterEach(() => {
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(path.join(getConfigRootDir(), "agent"));
			delete process.env.PI_CODING_AGENT_DIR;
		}
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("restores externalized tool-result image data", () => {
		const png = Buffer.from("not really a png, but distinct bytes \u0001\u0002\u0003");
		const { ref } = new BlobStore(getBlobsDir()).putSync(png, { extension: "png" });
		const entry = {
			type: "message",
			id: "e1",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [
					{ type: "text", text: "Read image" },
					{ type: "image", data: ref, mimeType: "image/png" },
				],
				isError: false,
				timestamp: 0,
			},
		};

		const [parsed] = agentTranscriptSource.parseEntries(`${JSON.stringify(entry)}\n`);

		expect(parsed?.type).toBe("message");
		const message = parsed?.type === "message" ? parsed.message : undefined;
		const content = message?.role === "toolResult" ? message.content : undefined;
		const image = content?.find(part => part.type === "image");
		expect(image).toEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	});
});
