/**
 * Load / error / empty states, ported from `/stats` (`ui/States.tsx`). Pages
 * fetch however they like; `AsyncView` is the one switch that decides what
 * to show for `{ data, error, loading }` so every page degrades the same way:
 * skeleton on first load, error strip above stale data, empty state when the
 * list is empty.
 */
import { RotateCw, TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Empty, NeoButton } from "./primitives";

export function ErrorState({ error, onRetry, className }: { error: Error | string; onRetry?: () => void; className?: string }) {
	return (
		<div className={className ? `neo-error-state ${className}` : "neo-error-state"} role="alert">
			<TriangleAlert size={15} />
			<span className="neo-error-state-message">{typeof error === "string" ? error : error.message}</span>
			{onRetry && (
				<NeoButton size="sm" variant="ghost" onClick={onRetry}>
					<RotateCw size={13} /> Retry
				</NeoButton>
			)}
		</div>
	);
}

/** Soft notice, for "saved" confirmations and similar. */
export function Notice({ children, tone, onDismiss }: { children: ReactNode; tone?: "ok" | "warn"; onDismiss?: () => void }) {
	return (
		<div className="neo-notice" data-tone={tone} role="status">
			<span className="min-w-0 flex-1">{children}</span>
			{onDismiss && (
				<NeoButton size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</NeoButton>
			)}
		</div>
	);
}

export function Skeleton({ width = "100%", height = 14, style }: { width?: number | string; height?: number | string; style?: CSSProperties }) {
	return <div className="neo-skeleton" style={{ width, height, ...style }} />;
}

/** Placeholder rows matching a table's footprint. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 16px 16px" }}>
			{Array.from({ length: rows }, (_, i) => (
				<Skeleton key={i} height={16} width={`${92 - ((i * 13) % 30)}%`} />
			))}
		</div>
	);
}

/** Placeholder matching a stat grid's footprint. */
export function StatSkeleton() {
	return <Skeleton height={96} style={{ borderRadius: 12 }} />;
}

export interface AsyncViewProps<T> {
	data: T | null | undefined;
	error?: string | Error | null;
	onRetry?: () => void;
	/** Rendered on first load. */
	skeleton?: ReactNode;
	/** Treat loaded data as empty (renders `empty`). */
	isEmpty?: (data: T) => boolean;
	empty?: ReactNode;
	children: (data: T) => ReactNode;
}

/**
 * Standard load/error/empty switch. Errors with data already on screen keep
 * the data and show the error above it.
 */
export function AsyncView<T>({ data, error, onRetry, skeleton, isEmpty, empty, children }: AsyncViewProps<T>) {
	if (data === null || data === undefined) {
		if (error) return <ErrorState error={error} onRetry={onRetry} />;
		return <>{skeleton ?? <TableSkeleton />}</>;
	}
	return (
		<>
			{error && <ErrorState error={error} onRetry={onRetry} />}
			{isEmpty?.(data) ? (empty ?? <Empty title="Nothing here yet" />) : children(data)}
		</>
	);
}
