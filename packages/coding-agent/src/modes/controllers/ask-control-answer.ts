import type {
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResult,
	ExtensionAskDialogResultItem,
} from "../../extensibility/extensions";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultItem(
	question: ExtensionAskDialogQuestion,
	selectedOptions: string[],
	customInput?: string,
	note?: string,
): ExtensionAskDialogResultItem {
	return {
		id: question.id,
		question: question.question,
		options: question.options.map(option => option.label),
		multi: question.multi ?? false,
		selectedOptions,
		...(customInput !== undefined ? { customInput } : {}),
		...(note !== undefined ? { note } : {}),
	};
}

function answerQuestion(
	question: ExtensionAskDialogQuestion,
	value: unknown,
): ExtensionAskDialogResultItem | undefined {
	let note: string | undefined;
	if (isObject(value)) {
		if (value.note !== undefined && typeof value.note !== "string") return undefined;
		note = value.note;
		if ("text" in value || "custom" in value) {
			const text = value.text ?? value.custom;
			return typeof text === "string" ? resultItem(question, [], text, note) : undefined;
		}
		if ("index" in value) {
			if (typeof value.index !== "number") return undefined;
			value = value.index;
		} else if ("indices" in value) {
			if (!Array.isArray(value.indices) || (!question.multi && value.indices.length !== 1)) return undefined;
			const selectedOptions: string[] = [];
			for (const index of value.indices) {
				if (!Number.isInteger(index) || index < 0 || index >= question.options.length) return undefined;
				selectedOptions.push(question.options[index].label);
			}
			return resultItem(question, selectedOptions, undefined, note);
		} else return undefined;
	}
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0 || value >= question.options.length) return undefined;
		return resultItem(question, [question.options[value].label], undefined, note);
	}
	if (typeof value === "string") {
		const option =
			question.options.find(option => option.label === value) ??
			question.options.find(option => option.label.trim().toLowerCase() === value.trim().toLowerCase());
		return option ? resultItem(question, [option.label], undefined, note) : resultItem(question, [], value, note);
	}
	return undefined;
}

/** Convert control-socket answers without exposing transport shapes to the ask tool. */
export function controlAnswerToAskResult(
	questions: ExtensionAskDialogQuestion[],
	value: unknown,
): ExtensionAskDialogResult | undefined {
	if (isObject(value) && value.kind === "chat") return { kind: "chat" };
	if (questions.length === 0) return undefined;
	const results: ExtensionAskDialogResultItem[] = [];
	if (isObject(value) && value.kind === "submit") {
		if (!Array.isArray(value.results) || value.results.length !== questions.length) return undefined;
		for (let index = 0; index < questions.length; index++) {
			const item = value.results[index];
			if (
				!isObject(item) ||
				!Array.isArray(item.selectedOptions) ||
				!item.selectedOptions.every(option => typeof option === "string") ||
				(item.customInput !== undefined && typeof item.customInput !== "string") ||
				(item.note !== undefined && typeof item.note !== "string")
			) {
				return undefined;
			}
			results.push(resultItem(questions[index], item.selectedOptions, item.customInput, item.note));
		}
		return { kind: "submit", results };
	}
	if (questions.length > 1 && Array.isArray(value) && value.length !== questions.length) return undefined;
	for (let index = 0; index < questions.length; index++) {
		const question = questions[index];
		let answer = value;
		if (questions.length > 1) {
			if (Array.isArray(value)) answer = value[index];
			else if (isObject(value) && Object.hasOwn(value, question.id)) answer = value[question.id];
			else return undefined;
		}
		const item = answerQuestion(question, answer);
		if (!item) return undefined;
		results.push(item);
	}
	return { kind: "submit", results };
}
