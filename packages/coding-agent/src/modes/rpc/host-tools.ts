import type { AgentTool, AgentToolResult, AgentToolUpdateCallback, ToolLoadMode } from "@oh-my-pi/pi-agent-core";
import type { Static, TSchema } from "@oh-my-pi/pi-ai";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { applyToolProxy } from "../../extensibility/tool-proxy";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import { defaultLoadModeForToolName } from "../../tools/essential-tools";
import type {
	RpcHostToolCallRequest,
	RpcHostToolCancelRequest,
	RpcHostToolDefinition,
	RpcHostToolResult,
	RpcHostToolUpdate,
} from "./rpc-types";

type RpcHostToolOutput = (frame: RpcHostToolCallRequest | RpcHostToolCancelRequest) => void;

type PendingHostToolCall = {
	toolName: string;
	resolve: (result: AgentToolResult<unknown>) => void;
	reject: (error: Error) => void;
	onUpdate?: AgentToolUpdateCallback<unknown>;
};

function isAgentToolResult(value: unknown): value is AgentToolResult<unknown> {
	if (!value || typeof value !== "object") return false;
	const content = (value as { content?: unknown }).content;
	return Array.isArray(content);
}

export function isRpcHostToolResult(value: unknown): value is RpcHostToolResult {
	if (!value || typeof value !== "object") return false;
	const frame = value as { type?: unknown; id?: unknown; result?: unknown };
	return frame.type === "host_tool_result" && typeof frame.id === "string" && isAgentToolResult(frame.result);
}

export function isRpcHostToolUpdate(value: unknown): value is RpcHostToolUpdate {
	if (!value || typeof value !== "object") return false;
	const frame = value as { type?: unknown; id?: unknown; partialResult?: unknown };
	return frame.type === "host_tool_update" && typeof frame.id === "string" && isAgentToolResult(frame.partialResult);
}

class RpcHostToolAdapter<TParams extends TSchema = TSchema, TTheme extends Theme = Theme> implements AgentTool<
	TParams,
	unknown,
	TTheme
> {
	declare name: string;
	declare label: string;
	declare description: string;
	declare parameters: TParams;
	readonly strict = true;
	concurrency: "shared" | "exclusive" = "shared";
	readonly loadMode: ToolLoadMode;
	#bridge: RpcHostToolBridge;
	#definition: RpcHostToolDefinition;

	constructor(definition: RpcHostToolDefinition, bridge: RpcHostToolBridge) {
		this.#definition = definition;
		this.#bridge = bridge;
		applyToolProxy(definition, this);
		this.loadMode = defaultLoadModeForToolName(definition.name, definition.loadMode);
	}

	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	): Promise<AgentToolResult<unknown>> {
		return this.#bridge.requestExecution(
			this.#definition,
			toolCallId,
			params as Record<string, unknown>,
			signal,
			onUpdate,
		);
	}
}

export class RpcHostToolBridge {
	#output: RpcHostToolOutput;
	#definitions = new Map<string, RpcHostToolDefinition>();
	#pendingCalls = new Map<string, PendingHostToolCall>();
	#closedError: Error | undefined;
	#registration: Promise<void> = Promise.resolve();
	#revision = 0;

	constructor(output: RpcHostToolOutput) {
		this.#output = output;
	}

	getToolNames(): string[] {
		return Array.from(this.#definitions.keys());
	}

	setTools(tools: RpcHostToolDefinition[]): AgentTool[] {
		this.#commitTools(tools);
		return tools.map(tool => new RpcHostToolAdapter(tool, this));
	}

	#commitTools(tools: RpcHostToolDefinition[]): void {
		const definitions = new Map(tools.map(tool => [tool.name, tool]));
		this.#rejectPendingCalls("Host tool registration revoked", definitions);
		this.#definitions = definitions;
	}

	/** Publish bridge definitions only after the session accepts the complete set. */
	refreshTools(tools: RpcHostToolDefinition[], refresh: (tools: AgentTool[]) => Promise<void>): Promise<void> {
		const revision = this.#revision;
		const registration = this.#registration.then(async () => {
			if (this.#closedError) throw this.#closedError;
			if (revision !== this.#revision) throw new Error("Host tool registration revoked");
			await refresh(tools.map(tool => new RpcHostToolAdapter(tool, this)));
			if (this.#closedError) throw this.#closedError;
			if (revision !== this.#revision) throw new Error("Host tool registration revoked");
			this.#commitTools(tools);
		});
		this.#registration = registration.catch(() => {});
		return registration;
	}

	/** Revoke adapters immediately, then remove only this bridge's session tools in order. */
	revokeTools(message: string, refresh: (tools: AgentTool[]) => Promise<void>): Promise<void> {
		this.#revision++;
		this.#definitions.clear();
		this.#rejectPendingCalls(message);
		const registration = this.#registration.then(() => refresh([]));
		this.#registration = registration.catch(() => {});
		return registration;
	}

	handleResult(frame: RpcHostToolResult): boolean {
		const pending = this.#pendingCalls.get(frame.id);
		if (!pending) return false;
		this.#pendingCalls.delete(frame.id);
		if (frame.isError) {
			const text = frame.result.content
				.filter(
					(item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string",
				)
				.map(item => item.text)
				.join("\n")
				.trim();
			pending.reject(new Error(text || "Host tool execution failed"));
			return true;
		}
		pending.resolve(frame.result);
		return true;
	}

	handleUpdate(frame: RpcHostToolUpdate): boolean {
		const pending = this.#pendingCalls.get(frame.id);
		if (!pending) return false;
		pending.onUpdate?.(frame.partialResult);
		return true;
	}

	requestExecution(
		definition: RpcHostToolDefinition,
		toolCallId: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	): Promise<AgentToolResult<unknown>> {
		if (signal?.aborted) {
			return Promise.reject(new Error(`Host tool "${definition.name}" was aborted`));
		}

		if (this.#closedError) {
			return Promise.reject(this.#closedError);
		}
		if (this.#definitions.get(definition.name) !== definition) {
			return Promise.reject(new Error(`Host tool "${definition.name}" registration revoked`));
		}

		const id = Snowflake.next() as string;
		const { promise, resolve, reject } = Promise.withResolvers<AgentToolResult<unknown>>();
		let settled = false;

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			this.#pendingCalls.delete(id);
		};

		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			this.#output({
				type: "host_tool_cancel",
				id: Snowflake.next() as string,
				targetId: id,
			});
			reject(new Error(`Host tool "${definition.name}" was aborted`));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		this.#pendingCalls.set(id, {
			toolName: definition.name,
			resolve: result => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(result);
			},
			reject: error => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			},
			onUpdate,
		});

		this.#output({
			type: "host_tool_call",
			id,
			toolCallId,
			toolName: definition.name,
			arguments: args,
		});

		return promise;
	}

	#rejectPendingCalls(message: string, retained?: ReadonlyMap<string, RpcHostToolDefinition>): void {
		let error: Error | undefined;
		for (const [id, pending] of this.#pendingCalls) {
			if (retained?.has(pending.toolName)) continue;
			this.#output({ type: "host_tool_cancel", id: Snowflake.next() as string, targetId: id });
			pending.reject((error ??= new Error(message)));
		}
	}

	/** Reject active and future host tool requests after the RPC client disconnects. */
	close(message: string): void {
		if (!this.#closedError) this.#closedError = new Error(message);
		this.#definitions.clear();
		this.#rejectPendingCalls(message);
	}
}
