import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import { lookupModelInfo } from "../config/model-info";
import modelDoc from "../prompts/internal-urls/model.md" with { type: "text" };
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, SchemeSpec } from "./types";

/** Read-only model selection facts from the calling session, never a process-global catalog. */
export class ModelProtocolHandler implements ProtocolHandler {
	readonly scheme = "model";
	readonly spec: SchemeSpec = { backing: "virtual", selectors: "none", immutable: true };

	promptDoc(): string {
		return modelDoc.trim();
	}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const session = context?.session;
		if (!session?.modelRegistry) throw new ToolError("model:// requires the calling session's model registry.");
		if (
			url.hash ||
			[...url.searchParams.keys()].some(key => key !== "selector") ||
			url.searchParams.getAll("selector").length > 1
		) {
			throw new ToolError(
				"Use model://<selector>, or model://?selector=<URL-encoded selector> for reserved characters.",
			);
		}
		let path: string;
		try {
			path = decodeURIComponent(url.rawPathname ?? url.pathname);
		} catch {
			throw new ToolError("model:// selector contains invalid URL encoding.");
		}
		const direct = `${url.rawHost}${path === "/" && !url.rawHost ? "" : path}`;
		const query = url.searchParams.get("selector");
		if (query !== null && direct)
			throw new ToolError("Choose either a model:// path selector or the selector query, not both.");
		const result = await lookupModelInfo(query ?? direct, session);
		const content = JSON.stringify(result, null, 2);
		return {
			url: url.href,
			content,
			contentType: "application/json",
			size: Buffer.byteLength(content),
			shape: "value",
		};
	}
}
