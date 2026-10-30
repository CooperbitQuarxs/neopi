import { Link } from "react-router-dom";

/** The NeoPi mark: the same gradient π glyph `/stats` and `/collab` use. */
export function NeoMark({ size = 22 }: { size?: number }) {
	return (
		<svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="shrink-0">
			<defs>
				<linearGradient id="neo-mark-grad" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="oklch(0.7 0.24 340)" />
					<stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
					<stop offset="1" stopColor="oklch(0.81 0.14 200)" />
				</linearGradient>
			</defs>
			<path fill="url(#neo-mark-grad)" d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
		</svg>
	);
}

/**
 * `◆ NeoPi / deck / Page` — product, then surface, then the current page in
 * a lighter weight. NeoPi is the first word on purpose: the deck is a
 * surface of the engine, not a product beside it.
 */
export function BrandLockup({ page }: { page?: string }) {
	return (
		<div className="neo-brand">
			<Link to="/" className="flex items-center gap-[10px] text-inherit no-underline" aria-label="Home">
				<NeoMark />
				<span>NeoPi</span>
			</Link>
			<span className="neo-brand-slash">/</span>
			<span className="neo-brand-title">deck</span>
			{page ? (
				<>
					<span className="neo-brand-slash hidden sm:inline">/</span>
					<span className="neo-brand-page hidden sm:inline">{page}</span>
				</>
			) : null}
		</div>
	);
}
