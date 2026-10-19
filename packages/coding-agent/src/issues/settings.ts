/** Settings for background issue filing; checkout overrides stay config-file only. */
import * as path from "node:path";
import { isRecord } from "@oh-my-pi/pi-utils";
import { register } from "../config/registry";
import { expandTilde } from "../tools/path-utils";

const EMPTY_CHECKOUTS: Record<string, string> = {};

/** Repository identity → local checkout path, expanded and verified during discovery. */
export const cfgIssuesCheckouts = register({
	id: "issues.checkouts",
	type: "record",
	default: EMPTY_CHECKOUTS,
	validate(raw) {
		if (raw === undefined) return;
		if (!isRecord(raw)) throw new Error("issues.checkouts must map repository names to absolute checkout paths");
		for (const [repo, checkout] of Object.entries(raw)) {
			if (
				!repo.trim() ||
				typeof checkout !== "string" ||
				!checkout.trim() ||
				!path.isAbsolute(expandTilde(checkout))
			) {
				throw new Error(
					`issues.checkouts[${JSON.stringify(repo)}] must be an absolute checkout path (~ is allowed)`,
				);
			}
		}
	},
});
