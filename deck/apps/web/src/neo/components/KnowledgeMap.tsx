/**
 * The knowledge map: an Obsidian-style force graph over the wiki, in the Neo
 * language. One component for both places that show it: Knowledge focuses it
 * on the open note (`focus` + `hops`), Studio shows the whole map. Nodes are
 * coloured by top-level directory, sized by inbound links; the focused note
 * carries the accent; hovering lights a node's neighbourhood and dims the
 * rest. Callers fetch `/api/kb/graph` and pass the response in.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { KbGraphNode, KbGraphResponse } from "@npi-deck/protocol";

export interface KnowledgeMapProps {
	graph: KbGraphResponse;
	/** Path of the note to centre on; with `hops` > 0 only its neighbourhood is drawn. */
	focus?: string;
	hops?: number;
	/** Case-insensitive filter on title, path and tags. */
	query?: string;
	hideOrphans?: boolean;
	/** Only this top-level directory. */
	onlyDir?: string | null;
	onOpen: (path: string) => void;
	className?: string;
}

interface MapNode extends NodeObject {
	id: string;
	path: string;
	title: string;
	dir: string;
	inbound: number;
	outbound: number;
	tags: string[];
}

interface MapLink {
	source: string;
	target: string;
}

/** Deterministic hue per top-level directory, so the same folder looks the same on every deck. */
export function dirHue(dir: string): number {
	const name = dir || "(root)";
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return h % 360;
}

export function dirColor(dir: string, alpha = 1): string {
	return `oklch(0.72 0.12 ${dirHue(dir)} / ${alpha})`;
}

function cssVar(name: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

export const KnowledgeMap = memo(function KnowledgeMap({ graph, focus, hops = 0, query, hideOrphans, onlyDir, onOpen, className }: KnowledgeMapProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const fgRef = useRef<ForceGraphMethods<MapNode, MapLink> | undefined>(undefined);
	const [size, setSize] = useState({ width: 600, height: 400 });
	const [hover, setHover] = useState<string | null>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const e = entries[0];
			if (!e) return;
			setSize({ width: Math.max(1, Math.floor(e.contentRect.width)), height: Math.max(1, Math.floor(e.contentRect.height)) });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const data = useMemo(() => {
		const q = (query ?? "").trim().toLowerCase();
		const matches = (n: KbGraphNode) => q === "" || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q));
		let keep = new Set<string>();
		for (const n of graph.nodes) {
			if (hideOrphans && n.inbound === 0 && n.outbound === 0) continue;
			if (onlyDir && (n.dir || "(root)") !== onlyDir) continue;
			if (!matches(n)) continue;
			keep.add(n.path);
		}
		if (focus && hops > 0 && keep.has(focus)) {
			const adjacency = new Map<string, Set<string>>();
			for (const e of graph.edges) {
				(adjacency.get(e.source) ?? adjacency.set(e.source, new Set()).get(e.source)!).add(e.target);
				(adjacency.get(e.target) ?? adjacency.set(e.target, new Set()).get(e.target)!).add(e.source);
			}
			const reach = new Set<string>([focus]);
			let frontier = [focus];
			for (let i = 0; i < hops; i++) {
				const next: string[] = [];
				for (const p of frontier) for (const n of adjacency.get(p) ?? []) if (!reach.has(n)) { reach.add(n); next.push(n); }
				frontier = next;
			}
			keep = new Set([...keep].filter((p) => reach.has(p)));
		}
		const neighbours = new Map<string, Set<string>>();
		const links: MapLink[] = [];
		for (const e of graph.edges) {
			if (!keep.has(e.source) || !keep.has(e.target)) continue;
			links.push({ source: e.source, target: e.target });
			(neighbours.get(e.source) ?? neighbours.set(e.source, new Set()).get(e.source)!).add(e.target);
			(neighbours.get(e.target) ?? neighbours.set(e.target, new Set()).get(e.target)!).add(e.source);
		}
		const nodes: MapNode[] = graph.nodes.filter((n) => keep.has(n.path)).map((n) => ({ id: n.path, path: n.path, title: n.title, dir: n.dir, inbound: n.inbound, outbound: n.outbound, tags: n.tags }));
		return { nodes, links, neighbours };
	}, [graph, focus, hops, query, hideOrphans, onlyDir]);

	useEffect(() => {
		const id = setTimeout(() => {
			const map = fgRef.current;
			if (!map) return;
			map.zoomToFit(0, 40);
			map.zoom(Math.min(map.zoom(), 2.5), 0);
		}, 500);
		return () => clearTimeout(id);
	}, [data.nodes.length, focus]);

	const ink = cssVar("--ink", "237 237 239");
	const accent = cssVar("--accent", "240 104 200");
	const lit = hover ? new Set([hover, ...(data.neighbours.get(hover) ?? [])]) : null;

	const paint = useCallback(
		(node: MapNode, ctx: CanvasRenderingContext2D, scale: number) => {
			const x = node.x ?? 0;
			const y = node.y ?? 0;
			const r = 2.2 + Math.log2(1 + node.inbound) * 1.6;
			const isFocus = node.path === focus;
			const dim = lit !== null && !lit.has(node.path);
			ctx.beginPath();
			ctx.arc(x, y, r, 0, 2 * Math.PI);
			ctx.fillStyle = isFocus ? `rgb(${accent})` : dirColor(node.dir, dim ? 0.25 : 1);
			ctx.fill();
			if (isFocus || node.path === hover) {
				ctx.beginPath();
				ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
				ctx.strokeStyle = isFocus ? `rgb(${accent} / 0.45)` : dirColor(node.dir, 0.5);
				ctx.lineWidth = 1.5 / scale;
				ctx.stroke();
			}
			const showLabel = data.nodes.length <= 80 || isFocus || node.path === hover || (lit?.has(node.path) ?? false) || scale > 1.6 || node.inbound >= 3;
			if (showLabel) {
				const fontSize = 11 / scale;
				ctx.font = `${isFocus ? 600 : 500} ${fontSize}px Inter, system-ui, sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.fillStyle = `rgb(${ink} / ${dim ? 0.3 : isFocus || node.path === hover ? 1 : 0.75})`;
				ctx.fillText(node.title, x, y + r + 2 / scale);
			}
		},
		[focus, hover, lit, ink, accent, data.nodes.length],
	);

	return (
		<div ref={containerRef} className={className} style={{ position: "relative", isolation: "isolate", overflow: "hidden", width: "100%", height: "100%", minHeight: 0 }}>
			<ForceGraph2D<MapNode, MapLink>
				ref={fgRef}
				graphData={data}
				width={size.width}
				height={size.height}
				backgroundColor="rgba(0,0,0,0)"
				nodeId="id"
				nodeLabel={() => ""}
				nodeCanvasObject={paint}
				nodePointerAreaPaint={(node, color, ctx) => {
					ctx.beginPath();
					ctx.arc(node.x ?? 0, node.y ?? 0, 6 + Math.log2(1 + node.inbound) * 1.6, 0, 2 * Math.PI);
					ctx.fillStyle = color;
					ctx.fill();
				}}
				linkColor={(l) => {
					const s = typeof l.source === "object" ? (l.source as MapNode).path : String(l.source);
					const t = typeof l.target === "object" ? (l.target as MapNode).path : String(l.target);
					const on = lit === null ? true : lit.has(s) && lit.has(t) && (s === hover || t === hover);
					return `rgb(${ink} / ${on ? 0.22 : 0.06})`;
				}}
				linkWidth={0.7}
				cooldownTicks={120}
				warmupTicks={60}
				enableNodeDrag={false}
				onNodeHover={(n) => setHover(n ? (n as MapNode).path : null)}
				onNodeClick={(n) => onOpen((n as MapNode).path)}
			/>
		</div>
	);
});

/** Top-level directories in a graph with counts and colours, for a legend. */
export function mapLegend(graph: KbGraphResponse): { name: string; count: number; color: string }[] {
	const counts = new Map<string, number>();
	for (const n of graph.nodes) counts.set(n.dir || "(root)", (counts.get(n.dir || "(root)") ?? 0) + 1);
	return [...counts.entries()].map(([name, count]) => ({ name, count, color: dirColor(name === "(root)" ? "" : name) })).sort((a, b) => b.count - a.count);
}
