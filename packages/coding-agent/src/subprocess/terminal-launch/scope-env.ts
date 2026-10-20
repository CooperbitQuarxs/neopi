/**
 * `env` prefix pinning each scope variable for a command launched into a
 * multiplexer pane. Multiplexer servers keep stale environment snapshots, so
 * every variable is pinned: defined values are assigned, absent (or empty)
 * ones are unset with `-u` (which must precede the assignments) rather than
 * exported as empty strings that `??`-style consumers would treat as a set,
 * relative path.
 */
export function scopeEnvCommand(scope: Readonly<Record<string, string | undefined>>): string[] {
	const unset: string[] = [];
	const assignments: string[] = [];
	for (const [name, value] of Object.entries(scope)) {
		if (value) assignments.push(`${name}=${value}`);
		else unset.push("-u", name);
	}
	return ["env", ...unset, ...assignments];
}
