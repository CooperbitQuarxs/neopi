interface BuildIdentity {
	readonly version: string;
	readonly gitSha: string | null;
	readonly dirty: boolean | null;
}

/** A source BUILD_INFO snapshot must report tracked changes, including generated bindings. */
export function verifySourceBuildInfo(
	info: BuildIdentity,
	expected: { version: string; gitSha: string; dirty: boolean },
): string {
	if (info.version !== expected.version) {
		throw new Error(`BUILD_INFO version ${info.version} != ${expected.version}`);
	}
	if (info.gitSha !== expected.gitSha) {
		throw new Error(`BUILD_INFO gitSha ${info.gitSha} != ${expected.gitSha}`);
	}
	if (info.dirty !== expected.dirty) {
		throw new Error(`BUILD_INFO dirty ${info.dirty} != tracked source status ${expected.dirty}`);
	}
	return `${info.version} ${info.gitSha} dirty=${info.dirty}`;
}
