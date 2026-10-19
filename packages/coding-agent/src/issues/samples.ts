/**
 * Historical example selection for `/issue` (#305): five distinct issues that
 * span the tracker's history, so one badly formatted recent filing cannot
 * become the only template for the next.
 */

/** Number of distinct example issues the authoring agent reads. */
export const ISSUE_SAMPLE_COUNT = 5;

/** Random examples drawn between the midpoint and the newest issue. */
const RANDOM_SAMPLE_COUNT = 3;

/**
 * Pick example issue numbers: the newest, the ordinal midpoint of the
 * creation-ordered history, then three random issues strictly between the
 * midpoint and the newest. Five or fewer issues → all of them. When that upper
 * range holds fewer than three, the remainder comes from the issues just below
 * the midpoint, newest first, so the result is still five distinct issues.
 *
 * @param issueNumbers every issue number in the tracker, any order (PRs excluded)
 * @param random uniform `[0, 1)` source; injectable for deterministic tests
 * @returns selected issue numbers, newest first
 */
export function selectIssueSamples(issueNumbers: readonly number[], random: () => number = Math.random): number[] {
	const ordered = [...new Set(issueNumbers)].sort((left, right) => left - right);
	if (ordered.length <= ISSUE_SAMPLE_COUNT) return ordered.reverse();

	const newestIndex = ordered.length - 1;
	const midpointIndex = Math.floor(newestIndex / 2);
	const picked = new Set<number>([newestIndex, midpointIndex]);

	const upper: number[] = [];
	for (let index = midpointIndex + 1; index < newestIndex; index++) upper.push(index);
	for (let drawn = 0; drawn < RANDOM_SAMPLE_COUNT && upper.length > 0; drawn++) {
		const slot = Math.min(upper.length - 1, Math.floor(random() * upper.length));
		picked.add(upper[slot]);
		upper.splice(slot, 1);
	}
	for (let index = midpointIndex - 1; picked.size < ISSUE_SAMPLE_COUNT && index >= 0; index--) picked.add(index);

	return [...picked].sort((left, right) => right - left).map(index => ordered[index]);
}
