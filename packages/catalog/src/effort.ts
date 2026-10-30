/** User-facing thinking levels, ordered least to most intensive. */
export const enum Effort {
	Minimal = "minimal",
	Low = "low",
	Medium = "medium",
	High = "high",
	XHigh = "xhigh",
	Max = "max",
}

export const THINKING_EFFORTS: readonly Effort[] = [
	Effort.Minimal,
	Effort.Low,
	Effort.Medium,
	Effort.High,
	Effort.XHigh,
	Effort.Max,
];

/** A concrete reasoning selection, including native reasoning disablement. */
export type ThinkingEffort = Effort | "off";

export const THINKING_CHOICES: readonly ThinkingEffort[] = ["off", ...THINKING_EFFORTS];
