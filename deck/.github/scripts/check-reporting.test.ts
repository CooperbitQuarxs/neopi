import { expect, test } from "bun:test";
import { escapeAnnotation } from "./typecheck.ts";
import { summarizeTests } from "./test-summary.ts";


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

test("deck CI marks failed tests informational on every event", () => {
	const result = summarizeTests(" 4 pass\n 1 fail\n", "failure", true);
	expect(result.failed).toBe(true);
	expect(result.markdown).toContain("informational on every deck CI event");
	expect(result.markdown).not.toContain("PRs and stable builds still fail");
});
