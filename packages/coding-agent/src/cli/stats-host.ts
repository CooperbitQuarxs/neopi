import { closeDb, startServer } from "@oh-my-pi/omp-stats";

/** A host owns this process by keeping stdin open. No browser or existing listener is touched. */
export async function runHostedStats(): Promise<void> {
	const hostToken = process.env.NEOPI_STATS_HOST_TOKEN;
	delete process.env.NEOPI_STATS_HOST_TOKEN;
	if (!hostToken || hostToken.length < 32)
		throw new Error("Managed stats requires NEOPI_STATS_HOST_TOKEN of at least 32 characters");
	const done = Promise.withResolvers<void>();
	let stopping = false;
	const stop = () => {
		stopping = true;
		done.resolve();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	process.stdin.once("end", stop);
	process.stdin.once("error", stop);
	process.stdin.resume();
	let closeServer: (() => void) | undefined;
	try {
		const server = await startServer(0, "127.0.0.1", {
			hostToken,
			judge: async () => {
				const { openStandaloneJudge } = await import("../judgment/standalone");
				return (await openStandaloneJudge(process.cwd(), "stats_frustration")).judge;
			},
		});
		closeServer = server.stop;
		if (!stopping)
			process.stdout.write(`${JSON.stringify({ type: "neopi_stats_ready", version: 1, port: server.port })}\n`);
		await done.promise;
	} finally {
		closeServer?.();
		closeDb();
		process.stdin.pause();
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
		process.stdin.removeListener("end", stop);
		process.stdin.removeListener("error", stop);
	}
	// A headless command is a dedicated process. Stop its native workers as well.
	if (stopping) process.exit(0);
}
