import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import toolDoc from "../prompts/internal-urls/tool.md" with { type: "text" };
import { toolCatalogDocs, toolCatalogListing } from "../tools/tool-catalog";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, SchemeSpec } from "./types";

/** Read-only view of the canonical enabled session registry, independent of XD transport. */
export class ToolProtocolHandler implements ProtocolHandler {
	readonly scheme = "tool";
	readonly spec: SchemeSpec = { backing: "virtual", selectors: "lines", immutable: true };

	promptDoc(): string {
		return toolDoc.trim();
	}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const session = context?.session;
		if (!session) throw new ToolError("tool:// requires a session tool registry.");
		if ((url.rawPathname && url.rawPathname !== "/") || url.search || url.hash) {
			throw new ToolError("Use tool:// to list enabled tools or tool://<name> for docs.");
		}
		const name = url.rawHost;
		const content = name ? toolCatalogDocs(session, name) : toolCatalogListing(session);
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content),
			isDirectory: !name,
		};
	}
}
