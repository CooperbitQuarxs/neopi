import { expect, it, vi } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Agent } from "../src/agent";
import type { AgentEvent, AgentTool } from "../src/types";

function harness() {
	const execute = vi.fn(async (_id: string, args: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(args) }],
	}));
	const tool: AgentTool = {
		name: "inspect",
		label: "Inspect",
		description: "Inspect a path",
		parameters: type({ path: "string" }),
		execute,
	};
	const stream = vi.fn(() => {
		throw new Error("Unexpected provider request");
	});
	const agent = new Agent({
		initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), tools: [tool] },
		streamFn: stream,
	});
	const events: AgentEvent[] = [];
	agent.subscribe(event => {
		events.push(event);
	});
	return { agent, tool, execute, stream, events };
}

it("runs the model dispatch hooks once and journals their revised arguments before execution", async () => {
	const h = harness();
	h.agent.beforeToolCall = vi.fn(async () => ({ args: { path: "revised.txt" } }));
	const after = vi.fn(async () => undefined);
	h.agent.afterToolCall = after;
	await h.agent.executeTool(h.tool, { path: "original.txt" });
	expect(h.execute).toHaveBeenCalledTimes(1);
	expect(h.execute.mock.calls[0]![1]).toEqual({ path: "revised.txt" });
	expect(h.agent.beforeToolCall).toHaveBeenCalledTimes(1);
	expect(after).toHaveBeenCalledTimes(1);
	const assistant = h.agent.state.messages.find(message => message.role === "assistant");
	expect(assistant?.content).toEqual([
		expect.objectContaining({ type: "toolCall", arguments: { path: "revised.txt" } }),
	]);
	expect(h.events.filter(event => event.type === "tool_execution_start")).toHaveLength(1);
	expect(h.events.filter(event => event.type === "tool_execution_end")).toHaveLength(1);
	expect(h.events.at(-1)?.type).toBe("agent_end");
	expect(h.agent.state.isStreaming).toBe(false);
	expect(h.stream).not.toHaveBeenCalled();
});

it("records hook denial as a normal error card without running the tool or provider", async () => {
	const h = harness();
	h.agent.beforeToolCall = async () => ({ block: true, reason: "Scope policy denied this path" });
	await h.agent.executeTool(h.tool, { path: "restricted.txt" });
	expect(h.execute).not.toHaveBeenCalled();
	expect(h.agent.state.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
	expect(h.events.find(event => event.type === "tool_execution_end")).toMatchObject({ isError: true });
	expect(h.stream).not.toHaveBeenCalled();
});
