import { expect, test } from "bun:test";
import { classifyTypecheck, escapeAnnotation } from "./typecheck.ts";
import { summarizeTests } from "./test-summary.ts";

const root = "/checkout/deck";
const pinned = "/runner/neopi/abc";
const cwd = `${root}/apps/server`;
const ownError = "src/routes.ts(2,3): error TS2322: Type 'string' is not assignable to type 'number'.";
const pinnedError = `${pinned}/packages/tui/src/wizard.ts(92,5): error TS2345: External diagnostic.`;

test("deck errors fail even if a compiler reports success", () => {
	expect(classifyTypecheck(ownError, 0, cwd, root, pinned).failed).toBe(true);
});

test("pinned-only compiler diagnostics stay visible and informational", () => {
	const result = classifyTypecheck(pinnedError, 2, cwd, root, pinned);
	expect(result.failed).toBe(false);
	expect(result.pinned).toHaveLength(1);
	expect(result.pinned[0]!.message).toBe(pinnedError);
});

test("pinned diagnostics never hide a deck error", () => {
	const result = classifyTypecheck(`${pinnedError}\n${ownError}`, 2, cwd, root, pinned);
	expect(result.failed).toBe(true);
	expect(result.own).toHaveLength(1);
});

test("unknown locations, global compiler errors, guard failures and crashes fail", () => {
	for (const [output, exit] of [
		["/runner/neopi/abcd/file.ts(1,1): error TS2322: Not the pinned tree.", 2],
		[`${pinnedError}\nerror TS18003: No inputs found`, 2],
		["kb-service.ts: child_process import", 1],
		["tsgo not found", 1],
		[pinnedError, 137],
	] as const) expect(classifyTypecheck(output, exit, cwd, root, pinned).failed).toBe(true);
});

test("Windows relative diagnostic paths resolve against their workspace", () => {
	const result = classifyTypecheck("../../../../neopi/abc/packages/tui/wizard.ts(1,2): error TS2345: Pinned.", 2,
		"D:\\runner\\deck\\apps\\server", "D:\\runner\\deck", "D:\\neopi\\abc");
	expect(result.failed).toBe(false);
	expect(result.pinned).toHaveLength(1);
});

test("successful checks without diagnostics pass", () => {
	expect(classifyTypecheck("server process creation uses owned-process wrappers", 0, cwd, root, pinned).failed).toBe(false);
});

test("test summary shows final counts and all unique failed names", () => {
	const result = summarizeTests("(fail) linked read-only worktree [3767.59ms]\n(fail) route <home> [0.1ms]\n24 tests failed:\n(fail) linked read-only worktree [3767.59ms]\n 821 pass\n 24 fail\n 1 error\n", "failure");
	expect(result.counts).toEqual({ pass: 821, fail: 24, error: 1 });
	expect(result.names).toEqual(["linked read-only worktree", "route <home>"]);
	expect(result.markdown).toContain("Failed: 24");
	expect(result.markdown).toContain("route &lt;home&gt;");
	expect(result.markdown).toContain("informational, not a passing test result");
});

test("runner/import failures without named tests remain visible", () => {
	const result = summarizeTests("Cannot find module fixture", "failure");
	expect(result.failed).toBe(true);
	expect(result.markdown).toContain("Failed: unavailable");
	expect(result.markdown).toContain("No failed test names were emitted");
});

test("counts cannot be hidden by a success outcome", () => {
	expect(summarizeTests(" 4 pass\n 1 fail\n", "success").failed).toBe(true);
	expect(summarizeTests(" 4 pass\n 0 fail\n", "success").failed).toBe(false);
});

test("workflow annotation content cannot inject a second command", () => {
	expect(escapeAnnotation("100%\n::error::injected\r")).toBe("100%25%0A::error::injected%0D");
});

test("multiple runner errors are counted", () => {
	expect(summarizeTests(" 0 pass\n 0 fail\n 2 errors\n", "failure").counts.error).toBe(2);
});
