import type { GraphObject } from "@npi-deck/protocol";
import type { GraphNodeRegistry } from "./graph-runner.ts";
import { runV0Action } from "./v0-action.ts";

/** V0 process arguments and output limits are intentionally not V1 run-step semantics. */
export function registerGraphV0Node(registry: GraphNodeRegistry): void {
	registry.register({
		settlesOnAbort: true,
		definition: {
			type: "process.v0", label: "Single process", kind: "action",
			inputs: [{ id: "in", type: "object", multiple: true }], outputs: [{ id: "result", type: "object" }],
			configSchema: {
				type: "object", required: ["kind", "body"],
				properties: { kind: { enum: ["bash", "script"] }, body: { type: "string" }, cwd: { type: "string" } },
				additionalProperties: false,
			},
		},
		execute: async context => {
			if (context.dryRun) return [];
			const config = context.node.config;
			let result: Awaited<ReturnType<typeof runV0Action>>;
			try {
				result = await runV0Action(config.kind as "bash" | "script", config.body as string, (config.cwd as string | undefined)?.trim() || process.cwd(), context.signal);
			} catch (error) {
				result = { stdoutExcerpt: "", stderrExcerpt: "", error: String(error) };
			}
			// Preserve the original exit code, including nonzero values, for aggregate history.
			context.recordDiagnostics?.({ v0: JSON.parse(JSON.stringify(result)) as GraphObject });
			if (result.error !== undefined || result.exitCode !== 0) throw new Error(result.error ?? `exit code ${result.exitCode}`);
			return [{ port: "result", value: result.stdoutExcerpt }];
		},
	});
}
