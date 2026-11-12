/**
 * Check for and install updates.
 */

import { APP_NAME } from "@oh-my-pi/pi-utils";
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { updateHelp as commandHelp } from "../cli/command-help";
import * as pluginCli from "../cli/plugin-cli";

export default class Update extends Command {
	static description = commandHelp.description;
	static flags = {
		check: Flags.boolean({ char: "c", description: "Only check plugin updates when used with --plugins", default: false }),
		plugins: Flags.boolean({ char: "l", description: "Update installed plugins", default: false }),
	};

	static examples = [`${APP_NAME} update`, `${APP_NAME} update --plugins --check`];

	async run(): Promise<void> {
		const { flags } = await this.parse(Update);
		if (flags.plugins) {
			await pluginCli.runPluginCommand({ action: "upgrade", args: [], flags: flags.check ? { dryRun: true } : {} });
		} else {
			console.log(
				"Binary self-update is not available in NeoPi yet. No update was checked or installed.\n" +
					"Get NeoPi builds from https://github.com/PsychedelicShayna/neopi/releases\n" +
					"Run the dedicated npi executable with exactly `update` for the source-fork integration workflow.",
			);
		}
	}
}
