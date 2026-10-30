#!/usr/bin/env bun
/** Stage and record the in-tree backend's native addon. Does not build or install dependencies. */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { initLoaderContext } from "../../packages/natives/native/loader-state.js";
import {
	addonProvenance, addonTarget, bunEngineProblem, containsNativeVersion, NATIVE_RECORD,
	nativeInputsFingerprint, nativeRecordMismatches, readNativeRecord, sha256, writeNativeRecord,
	type NativeRecord,
} from "../apps/server/src/backend/native-addon.ts";

interface NativeContext {
	platformTag: string;
	nativeDir: string;
	addonFilenames: string[];
	candidates: string[];
}

export function stageNativeAddon(tree: string, ctx: NativeContext, options: { built?: boolean; nativeDirs?: string[]; copy?: boolean } = {}): void {
	const engine = bunEngineProblem(tree);
	if (engine) throw new Error(engine);
	const packageVersion = (JSON.parse(fs.readFileSync(path.join(tree, "packages/natives/package.json"), "utf8")) as { version: string }).version;
	const inputs = nativeInputsFingerprint(tree);
	if (!inputs) throw new Error(`cannot fingerprint the native inputs of ${tree}: not a git work tree root`);
	const want = { inputs, platformTag: ctx.platformTag, addonFilenames: ctx.addonFilenames, packageVersion };
	const ownRecord = readNativeRecord(tree);
	const effective = () => ctx.candidates.find(file => fs.existsSync(file));

	function assess(file: string, loadName: string, allowDerived: boolean): NativeRecord {
		const bytes = fs.readFileSync(file);
		const bytesSha = sha256(bytes);
		if (!containsNativeVersion(bytes, packageVersion)) throw new Error(`lacks release ${packageVersion} stamp or legacy sentinel`);
		let record: NativeRecord;
		if (options.built && path.resolve(path.dirname(file)) === path.resolve(ctx.nativeDir) && !fs.lstatSync(file).isSymbolicLink()) {
			const target = addonTarget(path.basename(file));
			if (!target) throw new Error(`cannot tell the platform of ${file} from its filename`);
			// Explicit attestation immediately after a current-tree build or CI artifact staging.
			record = { inputs: want.inputs, ...target, sha256: bytesSha, packageVersion, provenance: "built", source: file };
		} else if (ownRecord?.sha256 === bytesSha && nativeRecordMismatches(ownRecord, loadName, bytesSha, want).length === 0) {
			record = ownRecord;
		} else {
			const found = addonProvenance(file, bytesSha, tree, allowDerived);
			if (typeof found === "string") {
				const changed = ownRecord && ownRecord.sha256 !== bytesSha ? `the recorded addon is sha256 ${ownRecord.sha256.slice(0, 12)}, this file is ${bytesSha.slice(0, 12)}; ` : "";
				throw new Error(`${changed}${found}`);
			}
			record = found.record;
		}
		const problems = nativeRecordMismatches(record, loadName, bytesSha, want);
		if (problems.length) throw new Error(problems.join("; "));
		return record;
	}

	let verified: { file: string; record: NativeRecord } | undefined;
	const current = effective();
	let allowDerived = true;
	if (current) {
		try { verified = { file: current, record: assess(current, path.basename(current), true) }; }
		catch (error) {
			console.error(`native addon ${current}: ${error instanceof Error ? error.message : error}`);
			if (path.resolve(path.dirname(current)) !== path.resolve(ctx.nativeDir)) throw error;
			if (ownRecord && sha256(fs.readFileSync(current)) !== ownRecord.sha256) allowDerived = false;
		}
	}
	if (!verified) {
		search: for (const name of ctx.addonFilenames) {
			for (const dir of options.nativeDirs ?? []) {
				for (const candidateDir of [path.resolve(dir), path.resolve(dir, "packages/natives/native")]) {
					const file = path.join(candidateDir, name);
					if (!fs.existsSync(file)) continue;
					let record: NativeRecord;
					try { record = assess(file, name, allowDerived); }
					catch (error) {
						console.error(`native addon ${file}: ${error instanceof Error ? error.message : error}`);
						continue;
					}
					// Retain the donor location for provenance; --copy stages an independent file.
					const dest = path.join(ctx.nativeDir, name);
					if (current) fs.unlinkSync(current);
					fs.rmSync(dest, { force: true });
					if (options.copy) fs.copyFileSync(file, dest);
					else fs.symlinkSync(fs.realpathSync(file), dest);
					verified = { file: dest, record };
					break search;
				}
			}
		}
	}
	if (!verified) throw new Error(`no native addon matching release ${packageVersion} and inputs ${inputs.slice(0, 12)}; pass --native-dir <matching checkout> or build with ./build.sh, then run this script with --built`);
	const file = effective();
	if (!file) throw new Error("native loader finds no addon after staging");
	const problems = nativeRecordMismatches(verified.record, path.basename(file), sha256(fs.readFileSync(file)), want);
	if (problems.length) throw new Error(`the loader would load ${file}, which does not match this tree: ${problems.join("; ")}`);
	writeNativeRecord(tree, verified.record);
	console.log(`Native addon recorded in ${path.join(tree, NATIVE_RECORD)}: ${file} (${verified.record.provenance}, inputs ${inputs.slice(0, 12)})`);
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: { "native-dir": { type: "string", multiple: true }, built: { type: "boolean", default: false }, copy: { type: "boolean", default: false } },
	});
	stageNativeAddon(path.resolve(import.meta.dir, "../.."), initLoaderContext(), { built: values.built, nativeDirs: values["native-dir"], copy: values.copy });
}
