import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { sessionsHelp } from "../cli/command-help";
import { listSessionCatalog, readSessionCatalog } from "../cli/sessions-cli";

export default class Sessions extends Command {
	static description = sessionsHelp.description;
	static args = {
		operation: Args.string({ required: true, options: ["list", "read"] }),
		file: Args.string({ description: "Session JSONL file for read" }),
	};
	static flags = {
		json: Flags.boolean({ description: "Emit a JSON document", default: false }),
		cwd: Flags.string({ description: "Project working directory" }),
		"session-dir": Flags.string({ description: "List exactly this directory (repeatable)", multiple: true }),
		all: Flags.boolean({ description: "List every project", default: false }),
		"max-messages": Flags.integer({ description: "Keep only the last N visible messages", min: 0 }),
	};

	async run(): Promise<void> {
		const json = this.argv.includes("--json");
		try {
			const { args, flags } = await this.parse(Sessions);
			if (args.operation === "read" && !args.file) throw new Error("sessions read requires a session file");
			if (args.operation === "list" && args.file) throw new Error("sessions list does not accept a session file");
			const result = args.operation === "read"
				? await readSessionCatalog(args.file!, flags["max-messages"])
				: await listSessionCatalog({ cwd: flags.cwd, sessionDirs: flags["session-dir"], all: flags.all });
			process.stdout.write(`${JSON.stringify(result)}\n`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`${json ? JSON.stringify({ type: "error", code: "session_catalog_error", message }) : message}\n`);
			process.exitCode = 1;
		}
	}
}
