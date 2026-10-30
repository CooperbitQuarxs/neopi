/**
 * Swimlane timeline in the language of `/stats`' trace view: a label gutter
 * on the left, a ruler on top, one lane per track with proportional span
 * bars coloured by kind (input · model · tool · agent · background) and
 * toned by outcome. DOM, not canvas: deck runs have tens of spans, not tens
 * of thousands, and DOM spans are focusable, hoverable and themeable for
 * free.
 */
import { type CSSProperties, type ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatElapsed } from "./format";

export type SpanKind = "input" | "model" | "tool" | "agent" | "background";
export type SpanTone = "ok" | "bad" | "warn" | "running" | "skipped";

export interface TimelineSpan {
	id: string;
	/** Epoch ms. */
	start: number;
	/** Epoch ms; `undefined` means still running (drawn to `now`). */
	end?: number;
	kind: SpanKind;
	label: string;
	tone?: SpanTone;
	/** Hover detail; the label and duration are appended. */
	title?: string;
}

export interface TimelineLane {
	id: string;
	label: ReactNode;
	sublabel?: ReactNode;
	spans: readonly TimelineSpan[];
	/** Point events (diamonds) on this lane. */
	markers?: readonly { id: string; at: number; label: string }[];
	depth?: number;
}

export interface TimelineProps {
	lanes: readonly TimelineLane[];
	/** Window; defaults to the extent of all spans. */
	start?: number;
	end?: number;
	now?: number;
	selected?: string | null;
	onSelect?: (span: TimelineSpan, lane: TimelineLane) => void;
	/** Gutter width in px. Default 188. */
	gutter?: number;
	className?: string;
}

export const SPAN_KINDS: readonly { kind: SpanKind; label: string }[] = [
	{ kind: "input", label: "Input" },
	{ kind: "model", label: "Model" },
	{ kind: "tool", label: "Tool" },
	{ kind: "agent", label: "Agent" },
	{ kind: "background", label: "Background" },
];

export function Timeline({ lanes, start, end, now = Date.now(), selected, onSelect, gutter = 188, className }: TimelineProps) {
	const window_ = useMemo(() => {
		let lo = start ?? Number.POSITIVE_INFINITY;
		let hi = end ?? Number.NEGATIVE_INFINITY;
		if (start === undefined || end === undefined) {
			for (const lane of lanes) {
				for (const span of lane.spans) {
					if (start === undefined) lo = Math.min(lo, span.start);
					if (end === undefined) hi = Math.max(hi, span.end ?? now);
				}
				for (const marker of lane.markers ?? []) {
					if (start === undefined) lo = Math.min(lo, marker.at);
					if (end === undefined) hi = Math.max(hi, marker.at);
				}
			}
		}
		if (!Number.isFinite(lo)) lo = now;
		if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1000;
		return { lo, hi, span: hi - lo };
	}, [lanes, start, end, now]);

	const ticks = useMemo(() => buildTicks(window_.span), [window_.span]);
	const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - window_.lo) / window_.span) * 100))}%`;

	return (
		<div className={cn("neo-timeline", className)} style={{ "--neo-timeline-gutter": `${gutter}px` } as CSSProperties}>
			<div className="neo-timeline-ruler">
				<div className="neo-timeline-gutter" />
				<div className="neo-timeline-track">
					{ticks.map((tick) => (
						<span key={tick} className="neo-timeline-tick" style={{ left: `${(tick / window_.span) * 100}%` }}>
							{tick === 0 ? "0" : `+${formatElapsed(tick)}`}
						</span>
					))}
				</div>
			</div>
			{lanes.map((lane) => (
				<div key={lane.id} className="neo-timeline-lane" data-depth={lane.depth ?? 0}>
					<div className="neo-timeline-gutter">
						<span className="neo-timeline-label truncate">{lane.label}</span>
						{lane.sublabel !== undefined && <span className="neo-timeline-sublabel truncate">{lane.sublabel}</span>}
					</div>
					<div className="neo-timeline-track">
						{ticks.map((tick) => (
							<span key={tick} className="neo-timeline-grid" style={{ left: `${(tick / window_.span) * 100}%` }} />
						))}
						{lane.spans.map((span) => {
							const endAt = span.end ?? now;
							const left = pct(span.start);
							const width = `${Math.max(0.35, ((Math.min(endAt, window_.hi) - Math.max(span.start, window_.lo)) / window_.span) * 100)}%`;
							const duration = formatElapsed(endAt - span.start);
							const title = `${span.title ? `${span.title}\n` : ""}${span.label} · ${duration}${span.end === undefined ? " (running)" : ""}`;
							const Tag = onSelect ? "button" : "div";
							return (
								<Tag
									key={span.id}
									type={onSelect ? "button" : undefined}
									className="neo-timeline-span"
									data-kind={span.kind}
									data-tone={span.tone ?? (span.end === undefined ? "running" : undefined)}
									data-selected={selected === span.id || undefined}
									style={{ left, width }}
									title={title}
									aria-label={title}
									onClick={onSelect ? () => onSelect(span, lane) : undefined}
								>
									<span className="neo-timeline-span-label">{span.label}</span>
								</Tag>
							);
						})}
						{(lane.markers ?? []).map((marker) => (
							<span key={marker.id} className="neo-timeline-marker" style={{ left: pct(marker.at) }} title={marker.label} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/** Colour legend for the span kinds a timeline uses. */
export function TimelineLegend({ kinds = SPAN_KINDS, className }: { kinds?: readonly { kind: SpanKind; label: string }[]; className?: string }) {
	return (
		<div className={cn("neo-timeline-legend", className)}>
			{kinds.map((item) => (
				<span key={item.kind} className="neo-timeline-legend-item">
					<span className="neo-swatch" data-kind={item.kind} />
					{item.label}
				</span>
			))}
		</div>
	);
}

/** Tick offsets (ms from the window start) at a readable density. */
function buildTicks(spanMs: number): number[] {
	const steps = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 43_200_000, 86_400_000];
	const target = spanMs / 6;
	const step = steps.find((s) => s >= target) ?? steps[steps.length - 1]! * Math.ceil(target / steps[steps.length - 1]!);
	const ticks: number[] = [];
	for (let t = 0; t < spanMs; t += step) ticks.push(t);
	return ticks;
}
