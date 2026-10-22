/** Embedded dashboards keep authentication in the host. Only API bytes cross the port. */
export const isHostedDashboard = () => document.querySelector('meta[name="neopi-stats-hosted"]') !== null;

/** srcdoc inherits the host's base URL. Keep fragment links inside the native document. */
export function navigateStatsHash(hash: string, replace = false): void {
	if (isHostedDashboard()) window.location.hash = hash;
	else if (replace) history.replaceState(null, "", hash);
	else history.pushState(null, "", hash);
}

if (typeof document !== "undefined" && isHostedDashboard()) {
	document.addEventListener("click", event => {
		const anchor = event.target instanceof Element ? event.target.closest("a") : null;
		const href = anchor?.getAttribute("href");
		if (!href?.startsWith("#")) return;
		event.preventDefault();
		navigateStatsHash(href);
	});
}

export function statsFetch(path: string, options: RequestInit = {}): Promise<Response> {
	if (!isHostedDashboard()) return fetch(path, options);
	if (!path.startsWith("/api/")) return Promise.reject(new Error("Invalid stats API path"));
	const channel = new MessageChannel();
	const result = Promise.withResolvers<Response>();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	let responded = false;
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		options.signal?.removeEventListener("abort", abort);
		channel.port1.close();
	};
	const abort = () => {
		channel.port1.postMessage({ type: "cancel" });
		const error = new DOMException("Stats request cancelled", "AbortError");
		if (responded) controller?.error(error);
		else result.reject(error);
		close();
	};
	channel.port1.onmessage = ({ data }) => {
		if (closed) return;
		if (data.type === "headers") {
			responded = true;
			if ([204, 205, 304].includes(data.status)) {
				result.resolve(new Response(null, { status: data.status, headers: data.headers }));
				channel.port1.postMessage({ type: "cancel" });
				close();
				return;
			}
			const stream = new ReadableStream<Uint8Array>({
				start(value) { controller = value; },
				pull() { channel.port1.postMessage({ type: "pull" }); },
				cancel() { channel.port1.postMessage({ type: "cancel" }); close(); },
			});
			result.resolve(new Response(stream, { status: data.status, headers: data.headers }));
		} else if (data.type === "chunk") {
			controller?.enqueue(data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes));
		} else if (data.type === "end") {
			controller?.close();
			close();
		} else if (data.type === "error") {
			const error = new Error(data.message);
			if (responded) controller?.error(error);
			else result.reject(error);
			close();
		}
	};
	window.parent.postMessage({
		type: "neopi-stats-request", version: 1, path,
		method: options.method ?? "GET",
		headers: Object.fromEntries(new Headers(options.headers)),
	}, "*", [channel.port2]);
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	return result.promise;
}

/** The same native SSE feed, carried by the host's authenticated streaming HTTP client. */
export function connectHostedEvents(callbacks: {
	onopen: () => void;
	onerror: () => void;
	onmessage: (data: string) => void;
}): () => void {
	const abort = new AbortController();
	let retry: ReturnType<typeof setTimeout> | undefined;
	const connect = async () => {
		try {
			const response = await statsFetch("/api/events", { signal: abort.signal });
			if (!response.ok || !response.body) throw new Error(`Stats stream HTTP ${response.status}`);
			callbacks.onopen();
			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let pending = "";
			try {
				while (!abort.signal.aborted) {
					const { value, done } = await reader.read();
					if (done) break;
					pending += value;
					let end: number;
					while ((end = pending.indexOf("\n\n")) >= 0) {
						const event = pending.slice(0, end);
						pending = pending.slice(end + 2);
						const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
						if (data) callbacks.onmessage(data);
					}
				}
			} finally { await reader.cancel(); }
		} catch {
			if (abort.signal.aborted) return;
		}
		if (!abort.signal.aborted) {
			callbacks.onerror();
			retry = setTimeout(connect, 3000);
		}
	};
	void connect();
	return () => { abort.abort(); clearTimeout(retry); };
}
