export interface MonitorLayoutConfig {
	maxRows: number | "infinite";
	maxColumns: number | "infinite";
	fillOrder: "rows-first" | "columns-first";
	growth: "fallback" | "alternate";
	direction: "down-right" | "up-left";
	rowHeight: number | "dynamic";
	columnWidth: number | "dynamic";
}

export const DEFAULT_MONITOR_LAYOUT: MonitorLayoutConfig = {
	maxRows: 2,
	maxColumns: "infinite",
	fillOrder: "rows-first",
	growth: "fallback",
	direction: "down-right",
	rowHeight: "dynamic",
	columnWidth: "dynamic",
};

export interface MonitorPaneGeometry {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MonitorLayoutPlan {
	width: number;
	height: number;
	panes: MonitorPaneGeometry[];
	/** Checksummed tmux custom layout, preserving pane identity and fill order. */
	layout: string;
}

interface Cell {
	rows: number;
	columns: number;
	index?: number;
	axis?: "rows" | "columns";
	children?: Cell[];
}

function strip(children: Cell[], axis: "rows" | "columns"): Cell {
	if (children.length === 1) return children[0]!;
	let rows = 0;
	let columns = 0;
	for (const child of children) {
		rows = axis === "rows" ? rows + child.rows : Math.max(rows, child.rows);
		columns = axis === "columns" ? columns + child.columns : Math.max(columns, child.columns);
	}
	return { axis, children, rows, columns };
}

function fallbackGrid(count: number, axis: "rows" | "columns", limit: number | "infinite"): Cell {
	const perStrip = limit === "infinite" ? count : Math.min(limit, count);
	const strips: Cell[] = [];
	for (let start = 0; start < count; start += perStrip) {
		const cells: Cell[] = [];
		for (let index = start; index < Math.min(start + perStrip, count); index++) {
			cells.push({ index, rows: 1, columns: 1 });
		}
		strips.push(strip(cells, axis));
	}
	return strip(strips, axis === "rows" ? "columns" : "rows");
}

function alternatingGrid(count: number, firstAxis: "rows" | "columns"): Cell {
	let root: Cell = { index: 0, rows: 1, columns: 1 };
	let axis = firstAxis;
	for (let start = 1; start < count;) {
		const edgeLength = axis === "rows" ? root.columns : root.rows;
		const children: Cell[] = [];
		for (let end = Math.min(start + edgeLength, count); start < end; start++) {
			children.push({ index: start, rows: 1, columns: 1 });
		}
		const edge = strip(children, axis === "rows" ? "columns" : "rows");
		// An unfinished edge spans the current grid; subsequent panes subdivide it.
		if (axis === "rows") edge.columns = root.columns;
		else edge.rows = root.rows;
		root = strip([root, edge], axis);
		axis = axis === "rows" ? "columns" : "rows";
	}
	return root;
}

function positiveInteger(value: number | "infinite" | "dynamic"): void {
	if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) {
		throw new Error("Monitor counts and dimensions must be positive safe integers");
	}
}

export function monitorWindowCapacity(config: MonitorLayoutConfig): number {
	positiveInteger(config.maxRows);
	positiveInteger(config.maxColumns);
	return config.maxRows === "infinite" || config.maxColumns === "infinite"
		? Infinity
		: config.maxRows * config.maxColumns;
}

/** Plan one window. Counts determine topology; dimensions never cause window overflow. */
export function planMonitorLayout(
	paneIds: readonly string[],
	config: MonitorLayoutConfig,
	width: number,
	height: number,
): MonitorLayoutPlan {
	if (paneIds.length === 0) throw new Error("A monitor layout needs at least one pane");
	if (paneIds.length > monitorWindowCapacity(config)) throw new Error("Monitor window capacity exceeded");
	positiveInteger(config.rowHeight);
	positiveInteger(config.columnWidth);
	const axis = config.fillOrder === "rows-first" ? "rows" : "columns";
	const root =
		config.growth === "alternate" && config.maxRows === "infinite" && config.maxColumns === "infinite"
			? alternatingGrid(paneIds.length, axis)
			: fallbackGrid(paneIds.length, axis, axis === "rows" ? config.maxRows : config.maxColumns);
	// Three cells leave room for a temporary split and the monitor's pane title.
	width =
		config.columnWidth === "dynamic"
			? Math.max(width, root.columns * 4 - 1)
			: root.columns * (config.columnWidth + 1) - 1;
	height =
		config.rowHeight === "dynamic"
			? Math.max(height, root.rows * 4 - 1)
			: root.rows * (config.rowHeight + 1) - 1;
	const panes: MonitorPaneGeometry[] = [];
	const render = (cell: Cell, x: number, y: number, w: number, h: number): string => {
		const prefix = `${w}x${h},${x},${y}`;
		if (cell.index !== undefined) {
			const id = paneIds[cell.index]!;
			panes[cell.index] = { id, x, y, width: w, height: h };
			return `${prefix},${id.slice(1)}`;
		}
		const horizontal = cell.axis === "columns";
		const total = cell.children!.reduce((sum, child) => sum + (horizontal ? child.columns : child.rows), 0);
		const size = horizontal ? w : h;
		let used = 0;
		if (config.direction === "up-left") cell.children!.reverse();
		const children = cell.children!.map(child => {
			const begin = Math.floor(((size + 1) * used) / total);
			used += horizontal ? child.columns : child.rows;
			const length = Math.floor(((size + 1) * used) / total) - begin - 1;
			return render(
				child,
				x + (horizontal ? begin : 0),
				y + (horizontal ? 0 : begin),
				horizontal ? length : w,
				horizontal ? h : length,
			);
		});
		return `${prefix}${horizontal ? "{" : "["}${children.join(",")}${horizontal ? "}" : "]"}`;
	};
	const body = render(root, 0, 0, width, height);
	let checksum = 0;
	for (let i = 0; i < body.length; i++) {
		checksum = ((checksum >> 1) | ((checksum & 1) << 15)) + body.charCodeAt(i);
		checksum &= 0xffff;
	}
	return { width, height, panes, layout: `${checksum.toString(16).padStart(4, "0")},${body}` };
}
