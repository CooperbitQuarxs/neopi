import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import {
	ChatTranscriptBuilder,
	type TranscriptLiveState,
	type TranscriptLiveTool,
} from "../src/chat/chat-transcript-builder";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
	type ChatTranscriptDisplayPreferences,
} from "../src/chat/display-preferences";
import type { SessionMessageEntryLike } from "../src/chat/transcript-entry";
import type { AgentRecordLike } from "../src/overlays/agent-hub-types";
import { AgentTranscriptViewer } from "../src/overlays/agent-transcript-viewer";
import { initTheme } from "../src/theme";
import { TUI } from "../src/tui";
import { VirtualTerminal } from "./virtual-terminal";

const builders: ChatTranscriptBuilder[] = [];
const viewers: AgentTranscriptViewer[] = [];
let savedPreferences: ChatTranscriptDisplayPreferences;

beforeAll(async () => {
	await initTheme(false);
});

beforeEach(() => {
	savedPreferences = { ...chatTranscriptDisplayPreferences };
	setChatTranscriptDisplayPreferences({ hideToolActivity: false, showImages: false, showTokenUsage: false });
});

afterEach(() => {
	for (const viewer of viewers.splice(0)) viewer.dispose();
	for (const builder of builders.splice(0)) builder.dispose();
	setChatTranscriptDisplayPreferences(savedPreferences);
});

function assistant(content: AssistantMessage["content"], timestamp = 10): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: content.some(block => block.type === "toolCall") ? "toolUse" : "stop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp,
	};
}

function entry(
	message: AssistantMessage | Extract<AgentMessage, { role: "toolResult" }>,
	id = `entry-${message.timestamp}`,
): SessionMessageEntryLike {
	return { type: "message", id, parentId: null, timestamp: new Date(message.timestamp).toISOString(), message };
}

function runningTool(id: string, text?: string, name = "lookup_live"): TranscriptLiveTool {
	return {
		toolCallId: id,
		toolName: name,
		args: { query: id },
		...(text === undefined ? {} : { partialResult: { content: [{ type: "text", text }] } }),
	};
}

function call(id: string): Extract<AssistantMessage["content"][number], { type: "toolCall" }> {
	return { type: "toolCall", id, name: "lookup_live", arguments: { query: id } };
}

function builder(): ChatTranscriptBuilder {
	const ui = new TUI(new VirtualTerminal(120, 40));
	const result = new ChatTranscriptBuilder({ ui, cwd: "/tmp", requestRender: () => {} });
	builders.push(result);
	return result;
}

function render(value: ChatTranscriptBuilder): string {
	return Bun.stripANSI([...value.container.render(110), ...value.liveContainer.render(110)].join("\n"));
}

function occurrences(output: string, text: string): number {
	return output.split(text).length - 1;
}

describe("ChatTranscriptBuilder pushed live tail", () => {
	it("renders streaming assistant text before persistence and replaces it in place on the next push", () => {
		const b = builder();
		b.setLive({ assistant: assistant([{ type: "text", text: "STREAMING_INITIAL" }]), tools: [] });
		expect(render(b)).toContain("STREAMING_INITIAL");
		b.setLive({ assistant: assistant([{ type: "text", text: "STREAMING_REVISED" }]), tools: [] });
		const output = render(b);
		expect(output).toContain("STREAMING_REVISED");
		expect(output).not.toContain("STREAMING_INITIAL");
	});

	it("removes the provisional duplicate when a same-timestamp assistant entry is appended", () => {
		const b = builder();
		const message = assistant([{ type: "text", text: "PERSISTED_ONCE" }]);
		b.setLive({ assistant: message, tools: [] });
		expect(occurrences(render(b), "PERSISTED_ONCE")).toBe(1);
		b.append([entry(message)]);
		expect(occurrences(render(b), "PERSISTED_ONCE")).toBe(1);
		// A stale owner snapshot must not bring the already-persisted tail back.
		b.setLive({ assistant: message, tools: [] });
		expect(occurrences(render(b), "PERSISTED_ONCE")).toBe(1);
	});

	it("moves partial tool progress onto the persisted pending card and lets the final result win", () => {
		const b = builder();
		const message = assistant([{ type: "text", text: "TOOL_TURN_ONCE" }, call("pending")]);
		const state: TranscriptLiveState = { assistant: message, tools: [runningTool("pending", "PARTIAL_PROGRESS")] };
		b.setLive(state);
		expect(occurrences(render(b), "PARTIAL_PROGRESS")).toBe(1);
		b.append([entry(message)]);
		let output = render(b);
		expect(occurrences(output, "TOOL_TURN_ONCE")).toBe(1);
		expect(occurrences(output, "PARTIAL_PROGRESS")).toBe(1);
		b.setLive({ tools: [runningTool("pending", "PARTIAL_UPDATED")] });
		output = render(b);
		expect(output).toContain("PARTIAL_UPDATED");
		expect(output).not.toContain("PARTIAL_PROGRESS");
		b.append([
			entry({
				role: "toolResult",
				toolCallId: "pending",
				toolName: "lookup_live",
				content: [{ type: "text", text: "FINAL_TOOL_OUTPUT" }],
				isError: false,
				timestamp: 11,
			}),
		]);
		// The last live progress may remain in flight after the final persisted result arrives.
		b.setLive(state);
		output = render(b);
		expect(occurrences(output, "FINAL_TOOL_OUTPUT")).toBe(1);
		expect(output).not.toContain("PARTIAL_PROGRESS");
		expect(output).not.toContain("PARTIAL_UPDATED");
	});

	it("renders a running tool with no persisted or streamed call card and removes it when it settles", () => {
		const b = builder();
		b.setLive({ tools: [runningTool("orphan", "RUNNING_WITHOUT_ASSISTANT")] });
		expect(render(b)).toContain("RUNNING_WITHOUT_ASSISTANT");
		b.setLive({ tools: [] });
		expect(render(b)).not.toContain("RUNNING_WITHOUT_ASSISTANT");
	});

	it("does not apply a sibling call's partial result to the wrong persisted pending card", () => {
		const b = builder();
		b.append([entry(assistant([call("first"), call("second")]))]);
		b.setLive({ tools: [runningTool("first", "FIRST_PROGRESS"), runningTool("second", "SECOND_PROGRESS")] });
		b.append([
			entry({
				role: "toolResult",
				toolCallId: "first",
				toolName: "lookup_live",
				content: [{ type: "text", text: "FIRST_FINISHED" }],
				isError: false,
				timestamp: 11,
			}),
		]);
		const output = render(b);
		expect(output).toContain("FIRST_FINISHED");
		expect(output).not.toContain("FIRST_PROGRESS");
		expect(occurrences(output, "SECOND_PROGRESS")).toBe(1);
	});

	it("clears only the live tail when live state becomes undefined", () => {
		const b = builder();
		b.append([entry(assistant([{ type: "text", text: "KEEP_PERSISTED_HISTORY" }], 1))]);
		b.setLive({
			assistant: assistant([{ type: "text", text: "REMOVE_LIVE_TEXT" }, call("clear")]),
			tools: [runningTool("clear", "REMOVE_LIVE_PROGRESS")],
		});
		expect(render(b)).toContain("REMOVE_LIVE_PROGRESS");
		b.setLive(undefined);
		const output = render(b);
		expect(output).toContain("KEEP_PERSISTED_HISTORY");
		expect(output).not.toContain("REMOVE_LIVE_TEXT");
		expect(output).not.toContain("REMOVE_LIVE_PROGRESS");
	});

	it("reapplies the current live snapshot after a transcript rebuild but clears it on reset", () => {
		const b = builder();
		b.setLive({ assistant: assistant([{ type: "text", text: "LIVE_AFTER_ROTATION" }]), tools: [] });
		const history = entry(assistant([{ type: "text", text: "REPLACEMENT_HISTORY" }], 1));
		b.rebuild([history]);
		let output = render(b);
		expect(output).toContain("REPLACEMENT_HISTORY");
		expect(occurrences(output, "LIVE_AFTER_ROTATION")).toBe(1);
		b.reset();
		b.append([history]);
		output = render(b);
		expect(output).not.toContain("LIVE_AFTER_ROTATION");
	});

	it("discards a withdrawn provisional tool instead of reviving its old progress when its id returns", () => {
		const b = builder();
		b.setLive({ assistant: assistant([call("rewritten")]), tools: [runningTool("rewritten", "WITHDRAWN_PROGRESS")] });
		expect(render(b)).toContain("WITHDRAWN_PROGRESS");
		b.setLive({ assistant: assistant([{ type: "text", text: "CALL_REMOVED" }]), tools: [] });
		expect(render(b)).not.toContain("WITHDRAWN_PROGRESS");
		b.setLive({ assistant: assistant([call("rewritten")]), tools: [runningTool("rewritten")] });
		expect(render(b)).not.toContain("WITHDRAWN_PROGRESS");
	});

	it("preserves expanded output across live pushes and replacement cards", () => {
		const b = builder();
		const progress = ["one", "two", "three", "four", "five", "six", "seven", "EXPANDED_EIGHTH_LINE"].join("\n");
		b.setLive({ tools: [runningTool("expand", progress)] });
		expect(render(b)).not.toContain("EXPANDED_EIGHTH_LINE");
		b.setExpanded(true);
		expect(render(b)).toContain("EXPANDED_EIGHTH_LINE");
		b.setLive({ tools: [runningTool("replacement", progress)] });
		expect(render(b)).toContain("EXPANDED_EIGHTH_LINE");
		b.setExpanded(false);
		expect(render(b)).not.toContain("EXPANDED_EIGHTH_LINE");
	});

	it("honors hidden tool activity for provisional cards without hiding assistant text", () => {
		setChatTranscriptDisplayPreferences({ hideToolActivity: true });
		const b = builder();
		b.setLive({
			assistant: assistant([{ type: "text", text: "VISIBLE_ASSISTANT" }, call("hidden")]),
			tools: [runningTool("hidden", "HIDDEN_TOOL_PROGRESS")],
		});
		const output = render(b);
		expect(output).toContain("VISIBLE_ASSISTANT");
		expect(output).not.toContain("HIDDEN_TOOL_PROGRESS");
	});
});

it("connects the viewer to pushed live text and releases its subscription on dispose", () => {
	let listener: ((state: TranscriptLiveState | undefined) => void) | undefined;
	let unsubscribed = 0;
	const ref: AgentRecordLike = {
		id: "owner/advisor",
		displayName: "advisor",
		kind: "advisor",
		status: "parked",
		session: null,
		sessionFile: null,
		createdAt: 0,
		lastActivity: 0,
	};
	const viewer = new AgentTranscriptViewer({
		agentId: ref.id,
		transcript: { fs, parseEntries: () => [] },
		registry: { list: () => [ref], get: id => (id === ref.id ? ref : undefined), onChange: () => () => {} },
		remote: { chat() {}, kill() {}, revive() {}, readTranscript: async () => ({ text: "", newSize: 0 }) },
		ui: new TUI(new VirtualTerminal(120, 40)),
		cwd: "/tmp",
		expandKeys: [],
		hubKeys: [],
		requestRender() {},
		onClose() {},
		onHubClose() {},
		live: {
			subscribe: callback => {
				listener = callback;
				return () => {
					unsubscribed++;
				};
			},
		},
	});
	viewers.push(viewer);
	listener?.({ assistant: assistant([{ type: "text", text: "VIEWER_LIVE_FEED" }]), tools: [] });
	expect(Bun.stripANSI(viewer.render(120).join("\n"))).toContain("VIEWER_LIVE_FEED");
	viewer.dispose();
	expect(unsubscribed).toBe(1);
	listener?.({ assistant: assistant([{ type: "text", text: "IGNORED_AFTER_DISPOSE" }]), tools: [] });
	expect(Bun.stripANSI(viewer.render(120).join("\n"))).not.toContain("IGNORED_AFTER_DISPOSE");
});
