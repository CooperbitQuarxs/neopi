import { describe, expect, test } from "bun:test";
import { rustTestCommands } from "./run-rs-task";

describe("Rust test task scope", () => {
	test("scopes nextest and doctests to one package without leaking nextest options", () => {
		const commands = rustTestCommands(["--package", "pi-natives", "-E", "test(desktop::)", "--run-ignored", "all"]);
		expect(commands).toEqual([
			[
				"cargo",
				"nextest",
				"run",
				"--package",
				"pi-natives",
				"--status-level=fail",
				"--final-status-level=fail",
				"-E",
				"test(desktop::)",
				"--run-ignored",
				"all",
			],
			["cargo", "test", "--doc", "--package", "pi-natives"],
		]);
	});

	test("keeps workspace scope and vendored exclusions when no package is given", () => {
		const commands = rustTestCommands([]);
		for (const command of commands) {
			expect(command).toContain("--workspace");
			expect(command).not.toContain("--package");
			expect(command.slice(command.indexOf("--exclude"), command.indexOf("--exclude") + 2)).toEqual([
				"--exclude",
				"brush-core",
			]);
			expect(command).toContain("napi");
		}
	});

	test("rejects incomplete or repeated package scopes rather than expanding silently", () => {
		for (const args of [["--package"], ["--package", "-E"], ["--package", "pi-natives", "--package", "pi-vcs"]]) {
			expect(() => rustTestCommands(args)).toThrow("test:rs accepts one --package <crate>");
		}
	});
});
