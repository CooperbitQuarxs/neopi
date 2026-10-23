import { describe, expect, test } from "bun:test";
import { verifySourceBuildInfo } from "./contract-identity.ts";

const source = { version: "18.10.3", gitSha: "d8c9c98b0f3097a981d03a6e2d4b8bb6b028ef90", dirty: false };

describe("source BUILD_INFO contract", () => {
	test("accepts a clean tree prepared with a prebuilt addon", () => {
		expect(verifySourceBuildInfo(source, source)).toBe(`${source.version} ${source.gitSha} dirty=false`);
	});

	test("accepts tracked binding changes left by a cold native build", () => {
		const dirty = { ...source, dirty: true };
		expect(verifySourceBuildInfo(dirty, dirty)).toBe(`${source.version} ${source.gitSha} dirty=true`);
	});

	test("rejects a different version even when commit and dirtiness match", () => {
		expect(() => verifySourceBuildInfo({ ...source, version: "18.3.2" }, source)).toThrow("BUILD_INFO version");
	});

	test("rejects a different commit even when version and dirtiness match", () => {
		expect(() => verifySourceBuildInfo({ ...source, gitSha: "0".repeat(40) }, source)).toThrow("BUILD_INFO gitSha");
	});

	test("rejects an unknown commit", () => {
		expect(() => verifySourceBuildInfo({ ...source, gitSha: null }, source)).toThrow("BUILD_INFO gitSha");
	});

	test("rejects dirty reporting for a clean tree", () => {
		expect(() => verifySourceBuildInfo({ ...source, dirty: true }, source)).toThrow("BUILD_INFO dirty");
	});

	test("rejects clean reporting for a dirty tree", () => {
		expect(() => verifySourceBuildInfo(source, { ...source, dirty: true })).toThrow("BUILD_INFO dirty");
	});

	for (const dirty of [false, true]) {
		test(`rejects unknown dirtiness when tracked source status is ${dirty}`, () => {
			expect(() => verifySourceBuildInfo({ ...source, dirty: null }, { ...source, dirty })).toThrow("BUILD_INFO dirty");
		});
	}
});
