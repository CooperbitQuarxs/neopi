import { describe, expect, it, vi } from "bun:test";
import { selectIssueSamples } from "../../src/issues/samples";

interface SampleRow {
	input: number[];
	expected: number[];
}

describe("issue history sampling", () => {
	const smallHistories: SampleRow[] = [
		{ input: [], expected: [] },
		{ input: [42], expected: [42] },
		{ input: [7, 2, 4, 3, 1], expected: [7, 4, 3, 2, 1] },
		{ input: [4, 4, 2, 9, 2, 1, 9, 7], expected: [9, 7, 4, 2, 1] },
	];
	it.each(smallHistories)(
		"returns every distinct issue newest-first for small history $input",
		({ input, expected }) => {
			const random = vi.fn(() => 0.5);
			expect(selectIssueSamples(input, random)).toEqual(expected);
			expect(random).not.toHaveBeenCalled();
		},
	);

	it("includes newest and the ordinal midpoint, with three deterministic distinct upper-half draws", () => {
		const input = [64, 1, 1024, 4, 256, 16, 2, 512, 8, 128, 32];
		const random = vi
			.fn(() => 0)
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0.999)
			.mockReturnValueOnce(0.5);
		const selected = selectIssueSamples(input, random);

		expect(selected).toEqual([1024, 512, 256, 64, 32]);
		expect(new Set(selected).size).toBe(5);
		expect(random).toHaveBeenCalledTimes(3);
	});

	it("uses floor((n - 1) / 2) for the midpoint of an even history", () => {
		expect(selectIssueSamples([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], () => 0)).toEqual([10, 8, 7, 6, 5]);
	});

	it("deduplicates before computing the midpoint and drawing examples", () => {
		const selected = selectIssueSamples([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10], () => 0);
		expect(selected).toEqual([10, 8, 7, 6, 5]);
		expect(new Set(selected).size).toBe(5);
	});

	const shortUpperRanges: SampleRow[] = [
		{ input: [1, 2, 3, 4, 5, 6], expected: [6, 5, 4, 3, 2] },
		{ input: [1, 2, 3, 4, 5, 6, 7], expected: [7, 6, 5, 4, 3] },
	];
	it.each(shortUpperRanges)(
		"backfills below midpoint when the upper range is too small: $input",
		({ input, expected }) => {
			const random = vi.fn(() => 0);
			expect(selectIssueSamples(input, random)).toEqual(expected);
			expect(random).toHaveBeenCalledTimes(2);
		},
	);
});
