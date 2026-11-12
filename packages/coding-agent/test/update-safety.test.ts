import { afterEach, expect, test, vi } from "bun:test";
import Update from "../src/commands/update";

afterEach(() => vi.restoreAllMocks());

test("binary update checks cannot contact a release source or offer an upstream installer", async () => {
	const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Release network access is forbidden"));
	const output = vi.spyOn(console, "log").mockImplementation(() => {});
	await new Update(["--check"], { bin: "npi", version: "0.0.0-test", commands: new Map() }).run();
	expect(fetch).not.toHaveBeenCalled();
	const notice = output.mock.calls.flat().join("\n");
	expect(notice).toContain("https://github.com/PsychedelicShayna/neopi/releases");
	expect(notice).not.toMatch(/omp\.sh|build\.stencil\.so|can1357\/oh-my-pi/);
});
