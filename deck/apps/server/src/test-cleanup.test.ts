import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeTestPath, withTestDirectorySymlink } from "./test-cleanup.ts";

let root = "";
afterEach(() => {
	if (root) removeTestPath(root);
	root = "";
});

function fixture(): string {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-test-cleanup-"));
	return root;
}

test("fixture removal unlinks directory and dangling links without removing their targets", () => {
	const home = fixture();
	const target = path.join(home, "outside");
	fs.mkdirSync(target);
	fs.writeFileSync(path.join(target, "keep.txt"), "keep");
	const linked = path.join(home, "linked");
	fs.symlinkSync(target, linked, "dir");
	removeTestPath(linked);
	expect(fs.existsSync(linked)).toBe(false);
	expect(fs.readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("keep");
	fs.symlinkSync(path.join(home, "missing"), linked, "dir");
	removeTestPath(linked);
	expect(() => fs.lstatSync(linked)).toThrow();
	removeTestPath(linked);
});

test("fixture removal removes a directory containing links without following them", () => {
	const home = fixture();
	const target = path.join(home, "outside");
	const directory = path.join(home, "fixture");
	fs.mkdirSync(target);
	fs.mkdirSync(directory);
	fs.writeFileSync(path.join(target, "keep.txt"), "keep");
	fs.symlinkSync(target, path.join(directory, "refs"), "dir");
	removeTestPath(directory);
	expect(fs.existsSync(directory)).toBe(false);
	expect(fs.readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("keep");
});

test("a failed body restores the shared directory before the next fixture setup", async () => {
	const home = fixture();
	const directory = path.join(home, "skills");
	const target = path.join(home, "outside");
	fs.mkdirSync(directory);
	fs.mkdirSync(target);
	fs.writeFileSync(path.join(directory, "original.txt"), "original");
	const failure = new Error("body failure");
	await expect(withTestDirectorySymlink(directory, target, async () => {
		expect(fs.realpathSync(directory)).toBe(fs.realpathSync(target));
		throw failure;
	})).rejects.toBe(failure);
	removeTestPath(target);
	fs.mkdirSync(path.join(directory, "next-skill"));
	expect(fs.readFileSync(path.join(directory, "original.txt"), "utf8")).toBe("original");
});

test("failed link cleanup is reported without leaving the shared directory dangling", async () => {
	const home = fixture();
	const directory = path.join(home, "skills");
	const target = path.join(home, "outside");
	fs.mkdirSync(directory);
	fs.mkdirSync(target);
	fs.writeFileSync(path.join(directory, "original.txt"), "original");
	const failure = Object.assign(new Error("held replacement link"), { code: "EBUSY" });
	const unlink = spyOn(fs, "unlinkSync").mockImplementation(() => { throw failure; });
	try {
		await expect(withTestDirectorySymlink(directory, target, async () => {})).rejects.toBe(failure);
	} finally {
		unlink.mockRestore();
	}
	removeTestPath(target);
	fs.mkdirSync(path.join(directory, "next-skill"));
	expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
	expect(fs.readFileSync(path.join(directory, "original.txt"), "utf8")).toBe("original");
});
