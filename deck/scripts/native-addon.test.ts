import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fakeAddon, fakeNeoPiTree, FAKE_PLATFORM, tempDir, type FakeTreeOptions } from "../apps/server/src/backend/fixtures/native-tree.ts";
import { nativeInputsFingerprint, readNativeRecord } from "../apps/server/src/backend/native-addon.ts";
import { stageNativeAddon } from "./native-addon.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function tree(options: FakeTreeOptions = {}) {
	const root = tempDir("deck-native-staging-");
	roots.push(root);
	return fakeNeoPiTree(path.join(root, "tree"), options);
}
function context(root: string, variant = "modern") {
	const nativeDir = path.join(root, "packages/natives/native");
	const addonFilenames = [`pi_natives.${FAKE_PLATFORM}-${variant}.node`];
	return { nativeDir, addonFilenames, platformTag: FAKE_PLATFORM, candidates: addonFilenames.map(name => path.join(nativeDir, name)) };
}
function built(options: FakeTreeOptions = {}) {
	const root = tree(options);
	fs.writeFileSync(context(root).candidates[0]!, fakeAddon("build", options.nativeVersionFormat));
	stageNativeAddon(root, context(root), { built: true });
	return root;
}

describe.skipIf(process.platform === "win32")("native addon staging without prepared trees", () => {
	for (const format of ["legacy", "stamp"] as const) {
		test(`records and reuses a fresh ${format} addon`, () => {
			const root = built({ nativeVersionFormat: format });
			const before = readNativeRecord(root);
			stageNativeAddon(root, context(root));
			expect(readNativeRecord(root)).toEqual(before);
			expect(before?.provenance).toBe("built");
		});
	}
	test("copies matching donor bytes and preserves the donor record", () => {
		const donor = built();
		const target = tree();
		stageNativeAddon(target, context(target), { nativeDirs: [donor], copy: true });
		expect(readNativeRecord(target)).toEqual(readNativeRecord(donor));
		expect(fs.lstatSync(context(target).candidates[0]!).isFile()).toBe(true);
	});
	test("labels source-equal unrecorded donor bytes derived", () => {
		const donor = tree();
		fs.writeFileSync(context(donor).candidates[0]!, fakeAddon("unobserved"));
		const target = tree();
		stageNativeAddon(target, context(target), { nativeDirs: [donor] });
		expect(readNativeRecord(target)?.provenance).toBe("derived");
		expect(readNativeRecord(target)?.inputs).toBe(nativeInputsFingerprint(target)!);
	});
	test("re-derives a linked donor after both checkouts move to matching native inputs", () => {
		const donor = tree();
		fs.writeFileSync(context(donor).candidates[0]!, fakeAddon("unobserved"));
		const target = tree();
		stageNativeAddon(target, context(target), { nativeDirs: [donor] });
		const before = readNativeRecord(target);
		for (const root of [donor, target]) fs.appendFileSync(path.join(root, "BUILD.bazel"), "# revised\n");
		stageNativeAddon(target, context(target));
		expect(readNativeRecord(target)?.sha256).toBe(before?.sha256);
		expect(readNativeRecord(target)?.inputs).not.toBe(before?.inputs);
		expect(readNativeRecord(target)?.provenance).toBe("derived");
	});
	test("refuses source-mismatched donors despite matching release", () => {
		const donor = built({ crate: "pub fn older() {}\n" });
		const target = tree();
		expect(() => stageNativeAddon(target, context(target), { nativeDirs: [donor] })).toThrow("no native addon matching");
		expect(readNativeRecord(target)).toBeNull();
		expect(fs.existsSync(context(target).candidates[0]!)).toBe(false);
	});
	test("does not vouch for an unrecorded in-place addon", () => {
		const target = tree();
		fs.writeFileSync(context(target).candidates[0]!, fakeAddon("unknown"));
		expect(() => stageNativeAddon(target, context(target))).toThrow("no native addon matching");
		expect(readNativeRecord(target)).toBeNull();
	});
	test("preserves recorded bytes when native inputs change until a new build is attested", () => {
		const target = built();
		const before = readNativeRecord(target);
		fs.appendFileSync(path.join(target, "Cargo.lock"), "# changed\n");
		expect(() => stageNativeAddon(target, context(target))).toThrow("no native addon matching");
		expect(readNativeRecord(target)).toEqual(before);
		fs.writeFileSync(context(target).candidates[0]!, fakeAddon("new build"));
		stageNativeAddon(target, context(target), { built: true });
		expect(readNativeRecord(target)?.inputs).not.toBe(before?.inputs);
	});
	test("replaced recorded bytes require a recorded donor, not source-only evidence", () => {
		const target = built();
		const recorded = readNativeRecord(target);
		fs.writeFileSync(context(target).candidates[0]!, fakeAddon("swapped"));
		const unrecorded = tree();
		fs.writeFileSync(context(unrecorded).candidates[0]!, fakeAddon("unknown donor"));
		expect(() => stageNativeAddon(target, context(target), { nativeDirs: [unrecorded] })).toThrow("no native addon matching");
		expect(readNativeRecord(target)).toEqual(recorded);
		const donor = built();
		stageNativeAddon(target, context(target), { nativeDirs: [donor] });
		expect(readNativeRecord(target)?.sha256).toBe(readNativeRecord(donor)?.sha256);
		expect(fs.readFileSync(context(target).candidates[0]!)).toEqual(fs.readFileSync(context(donor).candidates[0]!));
	});
	test("rejects a modern donor renamed to baseline", () => {
		const donor = built();
		fs.copyFileSync(context(donor).candidates[0]!, context(donor, "baseline").candidates[0]!);
		const target = tree({ variant: "baseline" });
		expect(() => stageNativeAddon(target, context(target, "baseline"), { nativeDirs: [donor] })).toThrow("no native addon matching");
		expect(readNativeRecord(target)).toBeNull();
	});
	test("checks the Bun engine before staging any bytes", () => {
		const target = tree({ bunEngine: ">=99.0.0" });
		expect(() => stageNativeAddon(target, context(target), { built: true })).toThrow(`Bun ${Bun.version} does not satisfy`);
		expect(readNativeRecord(target)).toBeNull();
	});
});
