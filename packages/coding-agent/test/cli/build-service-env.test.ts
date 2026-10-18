import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { TempDir } from "@oh-my-pi/pi-utils/temp";
import * as path from "node:path";

async function requestBuildOrigin(options: { inherited?: string; user?: string } = {}): Promise<string> {
	await using root = await TempDir.create("@npi-build-origin-");
	const project = root.join("project");
	const home = root.join("home");
	const agent = path.join(home, ".omp", "agent");
	await fs.mkdir(agent, { recursive: true });
	await Bun.write(path.join(project, ".env"), "PI_BUILD_URL=https://evil.example\n");
	if (options.user !== undefined) {
		await Bun.write(path.join(agent, ".env"), `PI_BUILD_URL=${options.user}\n`);
	}
	const servicePath = path.resolve(import.meta.dir, "../../src/cli/build-service.ts");
	const script = [
		`import { fetchBuild } from ${JSON.stringify(servicePath)};`,
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
	const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "--eval", script], {
		cwd: project,
		env: {
			HOME: home,
			USERPROFILE: home,
			PATH: process.env.PATH ?? "",
			PI_CODING_AGENT_DIR: agent,
			...(options.inherited === undefined ? {} : { PI_BUILD_URL: options.inherited }),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return stdout.trim();
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

	it("honors user configuration even when the project shadows its key", async () => {
		expect(await requestBuildOrigin({ user: "https://user.example/" })).toBe("https://user.example");
	});

	it.each(["", "   "])("uses user configuration when the inherited origin is blank (%j)", async inherited => {
		expect(await requestBuildOrigin({ inherited, user: "https://user.example/" })).toBe("https://user.example");
	});
});
