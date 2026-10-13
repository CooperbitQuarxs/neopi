import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildSpec,
	type CompletionSpec,
	generateCompletion,
	type Shell,
} from "@oh-my-pi/pi-coding-agent/cli/completion-gen";
import { commands } from "@oh-my-pi/pi-coding-agent/cli-commands";
import type { CliConfig, CommandCtor } from "@oh-my-pi/pi-utils/cli";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "npi-completions-"));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
let sequence = 0;

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function command(metadata: Partial<CommandCtor>): CommandCtor {
	return metadata as CommandCtor;
}

async function fixture(): Promise<CompletionSpec> {
	const config: CliConfig = {
		bin: "npi",
		version: "0",
		commands: new Map([
			[
				"launch",
				command({
					hidden: true,
					flags: {
						model: { kind: "string" },
						models: { kind: "string" },
						resume: { kind: "string", char: "r" },
						thinking: { kind: "string", options: ["low", "high"] },
						tools: { kind: "string" },
						print: { kind: "boolean", char: "p" },
					},
				}),
			],
			[
				"group",
				command({
					description: "Public group",
					subcommands: {
						index: async () =>
							command({
								aliases: ["ix"],
								flags: {
									rebuild: { kind: "boolean" },
									"dry-run": { kind: "boolean", char: "n" },
									format: { kind: "string", options: ["text", "json"] },
								},
								args: {
									action: { kind: "string", options: ["all", "recent"] },
									mode: { kind: "string", options: ["fast", "full"] },
								},
							}),
						nested: async () =>
							command({
								subcommands: {
									leaf: async () => command({ flags: { only: { kind: "boolean" } } }),
								},
							}),
						internal: async () => command({ hidden: true, aliases: ["secret"] }),
					},
				}),
			],
			["__complete", command({ hidden: true })],
		]),
	};
	return buildSpec(config, "launch", new Map([["group", ["g"]]]));
}

/** Invoke each shell's real completion API, including Zsh's completion widget. */
function candidates(shell: Shell, script: string, words: string[]): string[] {
	const dir = path.join(temporary, String(sequence++));
	fs.mkdirSync(dir);
	const completion = path.join(dir, `completion.${shell}`);
	fs.writeFileSync(completion, script);
	// Dynamic completion uses an executable, since `command npi` bypasses functions.
	fs.writeFileSync(
		path.join(dir, "npi"),
		`#!/bin/sh
case "$2" in
 models) printf 'catalog/model\\tModel\\ngroup\\tA model named like a command\\n' ;;
 sessions) printf 'session-123\\tSession\\n' ;;
esac
`,
		{ mode: 0o755 },
	);
	const line = words.join(" ");
	let invocation: string[];
	if (shell === "bash") {
		invocation = [
			"bash",
			"--noprofile",
			"--norc",
			"-c",
			`set -e
source ${quote(completion)}
COMP_WORDS=(${words.map(quote).join(" ")})
COMP_CWORD=${words.length - 1}
_npi
printf '%s\\n' "\${COMPREPLY[@]}"
`,
		];
	} else if (shell === "fish") {
		invocation = ["fish", "--no-config", "-c", `source ${quote(completion)}; complete -C ${quote(line)}`];
	} else {
		const output = path.join(dir, "candidates");
		const done = path.join(dir, "done");
		const ready = path.join(dir, "ready");
		const harness = path.join(dir, "harness.zsh");
		fs.writeFileSync(
			harness,
			`autoload -Uz compinit; compinit -D -u
source ${quote(completion)}
compadd() {
 local -a matches
 builtin compadd -A matches "$@"
 print -rl -- $matches >> ${quote(output)}
}
_npi_capture() {
 _main_complete
 print done > ${quote(done)}
}
zle -C npi-capture complete-word _npi_capture
bindkey '^X' npi-capture
unsetopt BEEP
print ready > ${quote(ready)}
`,
		);
		invocation = [
			"zsh",
			"-f",
			"-c",
			`zmodload zsh/zpty
zmodload zsh/zselect
zpty -b completion zsh -f
zpty -w completion ${quote(`source ${quote(harness)}`)}
for ((i=0; i<250; i++)); do [[ -f ${quote(ready)} ]] && break; zselect -t 1; done
if [[ ! -f ${quote(ready)} ]]; then zpty -d completion; exit 2; fi
zpty -w -n completion ${quote(line)}$'\\x18'
for ((i=0; i<250; i++)); do [[ -f ${quote(done)} ]] && break; zselect -t 1; done
zpty -d completion
[[ -f ${quote(done)} ]] || exit 3
[[ ! -f ${quote(output)} ]] || cat ${quote(output)}
`,
		];
	}
	const result = Bun.spawnSync(invocation, {
		cwd: dir,
		env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TERM: "xterm" },
		timeout: 10_000,
	});
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return [
		...new Set(
			result.stdout
				.toString()
				.split("\n")
				.map(row => row.split("\t")[0])
				.filter(Boolean),
		),
	];
}

for (const shell of ["bash", "fish", "zsh"] as const) {
	describe.skipIf(!Bun.which(shell))(`${shell} completion candidates`, () => {
		it("walks groups and aliases without leaking hidden commands or sibling flags", async () => {
			const script = generateCompletion(shell, await fixture());
			const root = candidates(shell, script, ["npi", ""]);
			expect(root).toContain("group");
			expect(root).toContain("g");
			expect(root).not.toContain("launch");
			expect(root).not.toContain("__complete");
			expect(candidates(shell, script, ["npi", "--"])).toContain("--version");
			const children = candidates(shell, script, ["npi", "g", ""]);
			expect(children).toContain("index");
			expect(children).toContain("ix");
			expect(children).toContain("nested");
			expect(children).not.toContain("internal");
			expect(children).not.toContain("secret");
			const flags = candidates(shell, script, ["npi", "g", "ix", "--"]);
			expect(flags).toContain("--rebuild");
			expect(flags).toContain("--dry-run");
			expect(flags).not.toContain("--model");
			expect(flags).not.toContain("--only");
			expect(flags).not.toContain("--version");
			expect(candidates(shell, script, ["npi", "group", "nested", "leaf", "--"])).toContain("--only");
		});

		it("uses the selected positional and flag value rather than matching arbitrary tokens", async () => {
			const script = generateCompletion(shell, await fixture());
			expect(candidates(shell, script, ["npi", "group", "index", "--format", ""])).toEqual(
				expect.arrayContaining(["text", "json"]),
			);
			expect(candidates(shell, script, ["npi", "group", "index", "--format=json", ""])).toEqual(
				expect.arrayContaining(["all", "recent"]),
			);
			const second = candidates(shell, script, ["npi", "group", "index", "--format", "json", "recent", ""]);
			expect(second).toContain("fast");
			expect(second).toContain("full");
			expect(second).not.toContain("recent");
			expect(second).not.toContain("index");
			const afterEnd = candidates(shell, script, ["npi", "group", "index", "--", ""]);
			expect(afterEnd).toContain("all");
			expect(afterEnd).not.toContain("--rebuild");
			const modelNamedCommand = candidates(shell, script, ["npi", "--model", "group", ""]);
			expect(modelNamedCommand).toContain("group");
			expect(modelNamedCommand).not.toContain("index");
		});

		it("preserves top-level dynamic model/session and finite flag completions", async () => {
			const script = generateCompletion(shell, await fixture());
			expect(candidates(shell, script, ["npi", "--model", "catalog/"])).toContain("catalog/model");
			expect(candidates(shell, script, ["npi", "-r", "session-"])).toContain("session-123");
			expect(candidates(shell, script, ["npi", "--thinking", "h"])).toContain("high");
		});

		it("covers the live public registry and Chronicle's child-specific surface", async () => {
			const generated = Bun.spawnSync(
				[process.execPath, path.resolve(import.meta.dir, "../../src/cli.ts"), "completions", shell],
				{
					cwd: path.resolve(import.meta.dir, "../.."),
					env: { ...process.env, PI_CODING_AGENT_DIR: path.join(temporary, "agent") },
					timeout: 30_000,
				},
			);
			expect(generated.exitCode, generated.stderr.toString()).toBe(0);
			const script = generated.stdout.toString();
			const root = candidates(shell, script, ["npi", ""]);
			for (const entry of commands) {
				const Cmd = await entry.load();
				if (Cmd.hidden || entry.name === "launch") {
					expect(root).not.toContain(entry.name);
					continue;
				}
				expect(root).toContain(entry.name);
				for (const alias of entry.aliases ?? []) expect(root).toContain(alias);
			}
			expect(root).not.toContain("chain");
			expect(candidates(shell, script, ["npi", "chronicle", ""])).toEqual(
				expect.arrayContaining(["backfill", "index", "recall"]),
			);
			const indexFlags = candidates(shell, script, ["npi", "chronicle", "index", "--"]);
			expect(indexFlags).toContain("--rebuild");
			expect(indexFlags).toContain("--dry-run");
			expect(indexFlags).not.toContain("--project");
			expect(candidates(shell, script, ["npi", "plugins", ""])).toContain("install");
			expect(candidates(shell, script, ["npi", "plugins", "marketplace", ""])).toEqual(
				expect.arrayContaining(["add", "remove", "rm", "update", "list"]),
			);
			expect(candidates(shell, script, ["npi", "plugin", "config", ""])).toEqual(
				expect.arrayContaining(["list", "get", "set", "delete", "validate"]),
			);
			expect(candidates(shell, script, ["npi", "models", ""])).toEqual(
				expect.arrayContaining(["ls", "list", "find", "refresh"]),
			);
			expect(candidates(shell, script, ["npi", "ctl", "target", ""])).toContain("dialog-answer");
		}, 30_000);
	});
}
