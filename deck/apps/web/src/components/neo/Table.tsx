/**
 * Sortable data table, ported from NeoPi's `/stats` (`ui/Table.tsx`). Column
 * definitions carry their own sort key, alignment and renderer so a page
 * declares what a table shows and the table owns how it behaves: clickable
 * headers that flip direction, keyboard-reachable rows, a "show more" foot
 * for long lists, and an expanded detail row.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Empty, NeoButton } from "./primitives";

export interface Column<T> {
	key: string;
	header: ReactNode;
	render: (row: T) => ReactNode;
	/** Sort key; the header becomes clickable when present. */
	sort?: (row: T) => number | string;
	align?: "left" | "right" | "center";
	width?: number | string;
	/** Allow the cell to wrap (cells are single-line by default). */
	wrap?: boolean;
	/** Header tooltip. */
	title?: string;
}

export type SortDir = "asc" | "desc";

export interface TableProps<T> {
	columns: readonly Column<T>[];
	rows: readonly T[];
	rowKey: (row: T) => string | number;
	onRowClick?: (row: T) => void;
	selectedKey?: string | number | null;
	/** Initial sort; numeric columns usually start `desc`. */
	initialSort?: { key: string; dir: SortDir };
	/** Show the first `limit` rows; "Show more" reveals `limit` × 4 more at a time. */
	limit?: number;
	dense?: boolean;
	empty?: ReactNode;
	/** Detail row rendered below a row (return `null` for collapsed rows). */
	expanded?: (row: T) => ReactNode | null;
	/** Extra attributes for a row, e.g. `data-tone`. */
	rowProps?: (row: T) => Record<string, string | undefined>;
	className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, selectedKey, initialSort, limit, dense, empty, expanded, rowProps, className }: TableProps<T>) {
	const [sort, setSort] = useState(initialSort ?? null);
	const [shown, setShown] = useState(limit ?? Number.POSITIVE_INFINITY);

	const sorted = useMemo(() => {
		const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
		if (!sort || !column?.sort) return rows;
		const valueOf = column.sort;
		const dir = sort.dir === "asc" ? 1 : -1;
		return [...rows].sort((a, b) => {
			const va = valueOf(a);
			const vb = valueOf(b);
			if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
			return String(va).localeCompare(String(vb)) * dir;
		});
	}, [rows, columns, sort]);

	if (rows.length === 0) return <>{empty ?? <Empty title="Nothing here yet" />}</>;

	const visible = sorted.length > shown ? sorted.slice(0, shown) : sorted;

	const toggleSort = (column: Column<T>) => {
		if (!column.sort) return;
		setSort((prev) =>
			prev?.key === column.key ? { key: column.key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: column.key, dir: column.align === "right" ? "desc" : "asc" },
		);
	};

	return (
		<>
			<div className={cn("neo-table-wrap", className)}>
				<table className="neo-table" data-dense={dense ?? false}>
					<thead>
						<tr>
							{columns.map((column) => {
								const sortedDir = sort?.key === column.key ? sort.dir : undefined;
								return (
									<th
										key={column.key}
										data-align={column.align ?? "left"}
										data-sortable={column.sort !== undefined}
										data-sorted={sortedDir}
										style={column.width !== undefined ? { width: column.width } : undefined}
										title={column.title}
										onClick={() => toggleSort(column)}
										aria-sort={sortedDir === "asc" ? "ascending" : sortedDir === "desc" ? "descending" : undefined}
									>
										{column.header}
										{sortedDir && <span className="neo-sort-arrow">{sortedDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{visible.map((row) => {
							const key = rowKey(row);
							const detail = expanded?.(row) ?? null;
							return (
								<Fragment key={key}>
									<tr
										data-clickable={onRowClick !== undefined}
										data-selected={selectedKey === key}
										onClick={onRowClick ? () => onRowClick(row) : undefined}
										onKeyDown={
											onRowClick
												? (e) => {
														if (e.target !== e.currentTarget) return;
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															onRowClick(row);
														}
													}
												: undefined
										}
										tabIndex={onRowClick ? 0 : undefined}
										{...rowProps?.(row)}
									>
										{columns.map((column) => (
											<td key={column.key} data-align={column.align ?? "left"} data-wrap={column.wrap ?? false}>
												{column.render(row)}
											</td>
										))}
									</tr>
									{detail !== null && (
										<tr data-detail="true">
											<td colSpan={columns.length} data-wrap="true" style={{ padding: 0 }}>
												{detail}
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
			{limit !== undefined && sorted.length > limit && (
				<div className="neo-table-more">
					<span className="neo-micro">
						{visible.length.toLocaleString()} of {sorted.length.toLocaleString()}
					</span>
					{sorted.length > shown && (
						<NeoButton size="sm" variant="ghost" onClick={() => setShown((n) => n + limit * 4)}>
							Show more
						</NeoButton>
					)}
					{shown > limit && (
						<NeoButton size="sm" variant="ghost" onClick={() => setShown(limit)}>
							Show fewer
						</NeoButton>
					)}
				</div>
			)}
		</>
	);
}

/** Right-aligned value with a proportional bar, for ranked numeric columns. */
export function MeterCell({ value, max, display, color }: { value: number; max: number; display: ReactNode; color?: string }) {
	const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
	return (
		<div className="neo-meter-cell">
			<span className="neo-num">{display}</span>
			<div className="neo-meter">
				<div className="neo-meter-fill" style={{ width: `${pct}%`, background: color }} />
			</div>
		</div>
	);
}

/** Two-line cell: primary label and a dim secondary line, with an optional lead glyph. */
export function LabelCell({ primary, secondary, lead, title }: { primary: ReactNode; secondary?: ReactNode; lead?: ReactNode; title?: string }) {
	return (
		<div className="neo-label-cell" title={title}>
			{lead}
			<div className="min-w-0 flex flex-col">
				<span className="neo-cell-primary truncate">{primary}</span>
				{secondary !== undefined && <span className="neo-cell-secondary truncate">{secondary}</span>}
			</div>
		</div>
	);
}
