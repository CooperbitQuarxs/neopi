import type { Tokenizer } from "@oh-my-pi/pi-agent-core";
import type { Context, Model } from "@oh-my-pi/pi-ai";
import type { SecretObfuscator } from "../secrets/obfuscator";
import type { ReadonlySessionManager } from "../session/session-manager";
import { readContracts, renderContractBlock } from "./store";

/** Run after context pruning, for the actual provider model, including mixture members. */
export function injectWorkContracts(
	context: Context,
	model: Model,
	manager: Pick<ReadonlySessionManager, "getEntries">,
	tokenizer: Tokenizer,
	obfuscator?: SecretObfuscator,
): Context {
	const block = renderContractBlock(readContracts(manager));
	if (!block) return context;
	const text = obfuscator?.obfuscates() ? obfuscator.obfuscate(block) : block;
	const systemPrompt = [...(context.systemPrompt ?? []), text];
	const requiredTokens =
		tokenizer.countTokens(systemPrompt) +
		tokenizer.countMessages(context.messages) +
		tokenizer.countTokens(JSON.stringify([context.tools ?? [], context.inactiveTools ?? []]));
	if (model.contextWindow > 0 && requiredTokens >= model.contextWindow) {
		throw new Error(
			`Session work contracts cannot fit intact in the context budget (${requiredTokens} estimated tokens, ${model.contextWindow} available). Compact context or edit/disable clauses with /contract. No contract text was truncated.`,
		);
	}
	return { ...context, systemPrompt };
}
