import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { TempDir } from "@oh-my-pi/pi-utils/temp";
import * as path from "node:path";

async function requestBuildOrigin(
	options: {
		inherited?: string;
		inheritedName?: string;
		platform?: NodeJS.Platform;
		user?: string;
		redirectAgent?: boolean;
		redirectConfig?: boolean;
		profile?: string;
		cliProfile?: boolean;
		projectProfile?: string;
		inheritedProfile?: string;
		rootUser?: string;
	} = {},
): Promise<string> {
	await using root = await TempDir.create("@npi-build-origin-");
	const project = root.join("project");
	const home = root.join("home");
	const config =
		options.profile && options.profile !== "default"
			? path.join(home, ".omp", "profiles", options.profile)
			: path.join(home, ".omp");
	const agent = path.join(config, "agent");
	await fs.mkdir(agent, { recursive: true });
	const autoload = options.redirectAgent || options.redirectConfig || options.projectProfile;
	await Bun.write(
		path.join(project, ".env"),
		`PI_BUILD_URL=https://evil.example\n${options.redirectAgent ? "PI_CODING_AGENT_DIR=./controlled\n" : ""}${options.redirectConfig ? "PI_CONFIG_DIR=../project/controlled\n" : ""}${options.projectProfile ? `OMP_PROFILE=${options.projectProfile}\n` : ""}`,
	);
	if (autoload) {
		await Bun.write(path.join(project, "controlled", ".env"), "PI_BUILD_URL=https://evil.example\n");
		await Bun.write(path.join(project, "controlled", "agent", ".env"), "PI_BUILD_URL=https://evil.example\n");
	}
	for (const profile of [options.projectProfile, options.inheritedProfile]) {
		if (profile) {
			await Bun.write(
				path.join(home, ".omp", "profiles", profile, "agent", ".env"),
				"PI_BUILD_URL=https://evil.example\n",
			);
		}
	}
	if (options.rootUser !== undefined) {
		await Bun.write(path.join(config, ".env"), `PI_BUILD_URL=${options.rootUser}\n`);
	}
	if (options.user !== undefined) {
		await Bun.write(path.join(agent, ".env"), `PI_BUILD_URL=${options.user}\n`);
	}
	const servicePath = path.resolve(import.meta.dir, "../../src/cli/build-service.ts");
	const script = [
		`import { fetchBuild } from ${JSON.stringify(servicePath)};`,
		...(options.platform
			? [`Object.defineProperty(process, "platform", { value: ${JSON.stringify(options.platform)} });`]
			: []),
		"let origin;",
		"await fetchBuild({ channel: 'stable' }, {",
		"  host: { target: 'linux-x86_64', fileName: 'npi-linux-x64' },",
		"  fetchImpl: async input => {",
		"    origin = new URL(input).origin;",
		"    return Response.json({ build: { version: '18.10.3' },",
		"      file: { name: 'npi-linux-x64', size: 1, sha256: 'a'.repeat(64) },",
		"      download: 'https://downloads.example/binary' });",
		"  },",
		"});",
		"console.log(origin);",
	].join("\n");
	const preload: string[] = [];
	if (options.cliProfile || options.projectProfile) {
		const bootstrap = root.join("profile-bootstrap.ts");
		await Bun.write(
			bootstrap,
			`import { runCli } from ${JSON.stringify(path.resolve(import.meta.dir, "../../src/cli.ts"))};\n` +
				`await runCli(${JSON.stringify(options.cliProfile ? ["--profile", options.profile, "--version"] : ["--version"])});\n`,
		);
		preload.push("--preload", bootstrap);
	}
	const child = Bun.spawn(
		[process.execPath, ...(autoload ? [] : ["--no-env-file"]), ...preload, "--no-install", "--eval", script],
		{
			cwd: project,
			env: {
				HOME: home,
				USERPROFILE: home,
				PATH: process.env.PATH ?? "",
				...(autoload
					? {}
					: {
							PI_CODING_AGENT_DIR: options.inheritedProfile
								? path.join(home, ".omp", "profiles", options.inheritedProfile, "agent")
								: options.cliProfile
									? path.join(home, ".omp", "agent")
									: agent,
						}),
				...(options.inheritedProfile
					? { OMP_PROFILE: options.inheritedProfile }
					: options.profile && !options.cliProfile
						? { OMP_PROFILE: options.profile }
						: {}),
				...(options.inherited === undefined
					? {}
					: { [options.inheritedName ?? "PI_BUILD_URL"]: options.inherited }),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return stdout.trim().split("\n").at(-1) ?? "";
}

describe("build origin trust", () => {
	it("ignores a project dotenv origin even when Bun dotenv autoload is disabled", async () => {
		expect(await requestBuildOrigin()).toBe("https://build.stencil.so");
	});

	it("honors the inherited origin ahead of project and user dotenv", async () => {
		expect(await requestBuildOrigin({ inherited: "https://launch.example/", user: "https://user.example" })).toBe(
			"https://launch.example",
		);
	});

	it.each(["pi_build_url", "Pi_BuIlD_Url"])(
		"honors case-insensitive Windows launch keys (%s)",
		async inheritedName => {
			expect(
				await requestBuildOrigin({
					inherited: "https://launch.example",
					inheritedName,
					platform: "win32",
					user: "https://user.example",
				}),
			).toBe("https://launch.example");
		},
	);

	it("keeps POSIX launch keys case-sensitive", async () => {
		expect(
			await requestBuildOrigin({
				inherited: "https://launch.example",
				inheritedName: "pi_build_url",
				platform: "linux",
				user: "https://user.example",
			}),
		).toBe("https://user.example");
	});

	it("honors user configuration even when the project shadows its key", async () => {
		expect(await requestBuildOrigin({ user: "https://user.example/" })).toBe("https://user.example");
	});

	it.each(["", "   "])("uses user configuration when the inherited origin is blank (%j)", async inherited => {
		expect(await requestBuildOrigin({ inherited, user: "https://user.example/" })).toBe("https://user.example");
	});

	it("rejects an agent dotenv selected by project autoload", async () => {
		expect(await requestBuildOrigin({ redirectAgent: true })).toBe("https://build.stencil.so");
	});

	it("retains the trusted root dotenv when project autoload redirects the agent directory", async () => {
		expect(await requestBuildOrigin({ redirectAgent: true, rootUser: "https://user.example" })).toBe(
			"https://user.example",
		);
	});

	it("retains the real user agent dotenv when project autoload redirects its directory", async () => {
		expect(await requestBuildOrigin({ redirectAgent: true, user: "https://user.example" })).toBe(
			"https://user.example",
		);
	});

	it("retains the agent dotenv selected by a launch profile", async () => {
		expect(await requestBuildOrigin({ profile: "work", user: "https://profile.example" })).toBe(
			"https://profile.example",
		);
	});

	it("retains the real user agent dotenv when project autoload redirects the config root", async () => {
		expect(await requestBuildOrigin({ redirectConfig: true, user: "https://user.example" })).toBe(
			"https://user.example",
		);
	});

	it("honors explicit CLI profile selection after launch capture", async () => {
		expect(await requestBuildOrigin({ cliProfile: true, profile: "work", user: "https://profile.example" })).toBe(
			"https://profile.example",
		);
	});

	it("does not trust a project-autoloaded profile activated by the CLI environment branch", async () => {
		expect(await requestBuildOrigin({ projectProfile: "attacker", user: "https://user.example" })).toBe(
			"https://user.example",
		);
	});

	it("drops an inherited profile-derived agent directory when CLI selects default", async () => {
		expect(
			await requestBuildOrigin({
				inheritedProfile: "work",
				cliProfile: true,
				profile: "default",
				user: "https://default.example",
			}),
		).toBe("https://default.example");
	});
});
