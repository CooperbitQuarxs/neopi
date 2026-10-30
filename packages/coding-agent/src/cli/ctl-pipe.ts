// Stdio transport for attaching a host without a second session writer (#355).
import { type Readable, type Writable } from "node:stream";
import { ControlClient } from "../control/client";
import type { ControlRegistryOptions } from "../control/registry";
import {
	MAX_RPC_FRAME_BYTES,
	MAX_RPC_REASSEMBLED_BYTES,
	RpcFrameDecoder,
	RpcFrameEncoder,
} from "../modes/rpc/rpc-frame";
import { resolveCtlTarget, type CtlIo } from "./ctl-cli";

export interface CtlPipeOptions {
	label?: string;
	registry?: ControlRegistryOptions;
	input?: Readable;
	io?: CtlIo;
	/** Writable transport; a false write result pauses the owner until drain. */
	output?: Writable;
}

export async function ctlPipe(selector: string, options: CtlPipeOptions = {}): Promise<number> {
	const input = options.input ?? process.stdin;
	const io = options.io ?? {
		stdout: (text: string) => {
			process.stdout.write(text);
		},
		stderr: (text: string) => {
			process.stderr.write(text);
		},
	};
	const output = new RpcFrameEncoder();
	const decoder = new RpcFrameDecoder();
	const subscribeId = "npi-pipe-subscribe";
	let subscribing = true;
	let relayed = false;
	let client: ControlClient | undefined;
	let buffer = "";
	let inputBlocked = false;
	let inputEnded = false;
	let unsubscribeDrain: (() => void) | undefined;
	const done = Promise.withResolvers<void>();
	let pendingOutput: Iterator<string> | undefined;
	let flushed = Promise.withResolvers<void>();
	const sink = options.output ?? (options.io ? undefined : process.stdout);
	const pumpOutput = () => {
		try {
			while (pendingOutput) {
				const next = pendingOutput.next();
				if (next.done) {
					pendingOutput = undefined;
					flushed.resolve();
					client?.resumeFrames();
					return;
				}
				if (sink) {
					if (!sink.write(next.value)) {
						client?.pauseFrames();
						return;
					}
				} else io.stdout(next.value);
			}
		} catch (error) {
			done.reject(error);
		}
	};
	sink?.on("drain", pumpOutput);
	sink?.on("error", onOutputError);
	function onOutputError(error: Error) {
		done.reject(error);
	}
	const onError = (error: Error) => done.reject(error);
	const forwardLine = (line: string): boolean => {
		if (!line.trim()) return true;
		const frame = decoder.push(JSON.parse(line));
		return !frame || client!.sendRaw(frame as Record<string, unknown>);
	};
	const pumpInput = () => {
		try {
			let newline = buffer.indexOf("\n");
			while (!inputBlocked && newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				inputBlocked = !forwardLine(line);
				newline = buffer.indexOf("\n");
			}
			if (!inputBlocked && inputEnded && buffer.length > 0) {
				const line = buffer;
				buffer = "";
				inputBlocked = !forwardLine(line);
			}
			if (inputBlocked) {
				input.pause();
			} else if (inputEnded) {
				client!.detach();
				done.resolve();
			}
		} catch (error) {
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	};
	const onData = (chunk: string | Buffer) => {
		buffer += chunk.toString();
		pumpInput();
	};
	const onEnd = () => {
		inputEnded = true;
		pumpInput();
	};
	const onDrain = () => {
		if (!inputBlocked) return;
		inputBlocked = false;
		pumpInput();
		if (!inputBlocked && !inputEnded) input.resume();
	};
	try {
		client = new ControlClient({
			metadata: await resolveCtlTarget(selector, options.registry),
			label: options.label ?? "ctl-pipe",
			kind: "cli",
			onFrame: frame => {
				if (subscribing && frame.type === "response" && frame.requestId === subscribeId) return;
				const relayedFrame =
					frame.type === "ready"
						? {
								...frame,
								maxFrameBytes: MAX_RPC_FRAME_BYTES,
								maxReassembledFrameBytes: MAX_RPC_REASSEMBLED_BYTES,
							}
						: frame;
				flushed = Promise.withResolvers<void>();
				pendingOutput = output.encodeFrames(relayedFrame)[Symbol.iterator]();
				pumpOutput();
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
		unsubscribeDrain = client.onDrain(onDrain);
		input.on("data", onData);
		input.once("end", onEnd);
		input.once("error", onError);
		if (input.readableEnded) onEnd();
		await done.promise;
		if (pendingOutput) await flushed.promise;
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!relayed) io.stderr(`${JSON.stringify({ type: "startup_error", code: "control_unavailable", message })}\n`);
		else if (!client?.closed)
			io.stderr(`${JSON.stringify({ type: "error", code: "control_pipe_error", message })}\n`);
		return client?.closed && relayed ? 0 : 1;
	} finally {
		input.off("data", onData);
		input.off("end", onEnd);
		input.off("error", onError);
		input.pause();
		unsubscribeDrain?.();
		sink?.off("drain", pumpOutput);
		sink?.off("error", onOutputError);
		client?.detach();
	}
}
