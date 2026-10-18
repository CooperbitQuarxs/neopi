// Stdio transport for attaching a host without a second session writer (#355).
import type { Readable } from "node:stream";
import { ControlClient } from "../control/client";
import type { ControlRegistryOptions } from "../control/registry";
import { RpcFrameDecoder, RpcFrameEncoder } from "../modes/rpc/rpc-frame";
import { resolveCtlTarget, type CtlIo } from "./ctl-cli";

export interface CtlPipeOptions {
	label?: string;
	registry?: ControlRegistryOptions;
	input?: Readable;
	io?: CtlIo;
}

export async function ctlPipe(selector: string, options: CtlPipeOptions = {}): Promise<number> {
	const input = options.input ?? process.stdin;
	const io = options.io ?? { stdout: (text: string) => { process.stdout.write(text); }, stderr: (text: string) => { process.stderr.write(text); } };
	const output = new RpcFrameEncoder();
	const decoder = new RpcFrameDecoder();
	const subscribeId = "npi-pipe-subscribe";
	let subscribing = true;
	let relayed = false;
	let client: ControlClient | undefined;
	let buffer = "";
	const done = Promise.withResolvers<void>();
	const onError = (error: Error) => done.reject(error);
	const forwardLine = (line: string) => {
		if (!line.trim()) return;
		const frame = decoder.push(JSON.parse(line));
		if (frame) client!.sendRaw(frame as Record<string, unknown>);
	};
	const onData = (chunk: string | Buffer) => {
		try {
			buffer += chunk.toString();
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				forwardLine(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
			}
		} catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
	};
	const onEnd = () => {
		try {
			forwardLine(buffer);
			client!.detach();
			done.resolve();
		} catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
	};
	try {
		client = new ControlClient({
			metadata: await resolveCtlTarget(selector, options.registry),
			label: options.label ?? "ctl-pipe", kind: "cli",
			onFrame: frame => {
				if (subscribing && frame.type === "response" && frame.requestId === subscribeId) return;
				io.stdout(output.encode(frame));
				relayed = true;
				if (frame.type === "response" && frame.command === "negotiate_protocol" && frame.success === true) {
					output.setProtocolVersion(2);
				}
			},
		});
		await client.connect();
		client.onClose(() => done.resolve());
		const subscribed = await client.request({ type: "subscribe", events: "all", requestId: subscribeId });
		if (!subscribed.success) throw new Error(subscribed.error ?? "subscription failed");
		subscribing = false;
		// Install listeners before resuming stdin; a ready frame can precede connect's resolution.
		input.setEncoding("utf8");
		input.on("data", onData);
		input.once("end", onEnd);
		input.once("error", onError);
		if (input.readableEnded) onEnd();
		await done.promise;
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!relayed) io.stderr(`${JSON.stringify({ type: "startup_error", code: "control_unavailable", message })}\n`);
		else if (!client?.closed) io.stderr(`${JSON.stringify({ type: "error", code: "control_pipe_error", message })}\n`);
		return client?.closed && relayed ? 0 : 1;
	} finally {
		input.off("data", onData);
		input.off("end", onEnd);
		input.off("error", onError);
		input.pause();
		client?.detach();
	}
}
