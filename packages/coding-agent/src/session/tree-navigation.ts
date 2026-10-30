import * as path from "node:path";

/** Native identity and branch observed by a remote tree client. */
export interface TreeNavigationExpected {
	expectedSessionId: string;
	expectedSessionFile: string | null;
	expectedLeafId: string | null;
}

export interface TreeNavigationState {
	sessionId: string;
	sessionFile?: string;
	leafId: string | null;
}

export type TreeNavigationErrorCode =
	| "session_busy"
	| "session_changed"
	| "leaf_changed"
	| "invalid_target"
	| "invalid_request"
	| "invalid_resume";

export class TreeNavigationError extends Error {
	constructor(
		readonly code: TreeNavigationErrorCode,
		message: string,
	) {
		super(message);
		this.name = "TreeNavigationError";
	}
}

export function assertTreeNavigationExpected(
	expected: TreeNavigationExpected,
	sessionId: string,
	sessionFile: string | undefined,
	leafId: string | null,
): void {
	if (
		expected.expectedSessionId !== sessionId ||
		(expected.expectedSessionFile === null
			? sessionFile !== undefined
			: sessionFile === undefined || path.resolve(expected.expectedSessionFile) !== path.resolve(sessionFile))
	) {
		throw new TreeNavigationError("session_changed", "The native session identity has changed");
	}
	if (expected.expectedLeafId !== leafId) {
		throw new TreeNavigationError("leaf_changed", "The native session leaf has changed");
	}
}
