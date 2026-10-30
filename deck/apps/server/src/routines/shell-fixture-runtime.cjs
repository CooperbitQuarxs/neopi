const fs = require("node:fs");
const { spawn } = require("node:child_process");

const [mode, encoded, renderedValue] = process.argv.slice(2);
const config = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
if (config.expectedCwd && fs.realpathSync(process.cwd()) !== fs.realpathSync(config.expectedCwd)) {
	throw new Error("fixture did not run in its configured cwd");
}

async function main() {
	if (mode === "write") {
		const bytes = (renderedValue ?? config.bytes ?? "") + (config.newline ? "\n" : "");
		if (config.append) fs.appendFileSync(config.marker, bytes, "utf8");
		else fs.writeFileSync(config.marker, bytes, "utf8");
	} else if (mode === "hold") {
		fs.appendFileSync(config.marker, "start\n", "utf8");
		while (!fs.existsSync(config.release)) await new Promise(resolve => setTimeout(resolve, 50));
		fs.appendFileSync(config.marker, "end\n", "utf8");
	} else if (mode === "release") {
		while (!fs.existsSync(config.release)) await new Promise(resolve => setTimeout(resolve, 5));
	} else if (mode === "tree") {
		const child = spawn(process.execPath, [__filename, "grandchild",
			Buffer.from(JSON.stringify({ ...config, shell: process.ppid })).toString("base64url")],
			{ stdio: ["ignore", "inherit", "inherit"] });
		while (!fs.existsSync(config.marker)) await new Promise(resolve => setTimeout(resolve, 5));
		await new Promise((resolve, reject) => {
			child.once("exit", resolve);
			child.once("error", reject);
		});
	} else if (mode === "grandchild") {
		const ready = { shell: config.shell, parent: process.ppid, grandchild: process.pid };
		await Promise.all([
			new Promise((resolve, reject) => process.stdout.write("tree stdout ready\n", error => error ? reject(error) : resolve())),
			new Promise((resolve, reject) => process.stderr.write("tree stderr ready\n", error => error ? reject(error) : resolve())),
		]);
		fs.writeFileSync(config.marker + ".tmp", JSON.stringify(ready));
		fs.renameSync(config.marker + ".tmp", config.marker);
		await new Promise(resolve => setTimeout(resolve, 30_000));
	} else if (mode !== "success") {
		throw new Error(`unknown shell fixture mode: ${mode}`);
	}
	process.exitCode = config.exitCode ?? 0;
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
