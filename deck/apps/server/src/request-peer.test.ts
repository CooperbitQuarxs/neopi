import { expect, test } from "bun:test";
import { localListenerOrigin } from "./request-peer.ts";

test("worker callback origins bracket IPv6 and replace wildcard binds with reachable loopback", () => {
	for (const [bind, expected] of [
		["::1", "http://[::1]:1701"],
		["[::1]", "http://[::1]:1701"],
		["::", "http://[::1]:1701"],
		["[::]", "http://[::1]:1701"],
		["0.0.0.0", "http://127.0.0.1:1701"],
		["127.0.0.1", "http://127.0.0.1:1701"],
		["localhost", "http://localhost:1701"],
	]) {
		const origin = localListenerOrigin(bind!, 1701);
		expect(origin).toBe(expected!);
		expect(new URL(`${origin}/api/kb/agent/read`).origin).toBe(expected!);
	}
});
