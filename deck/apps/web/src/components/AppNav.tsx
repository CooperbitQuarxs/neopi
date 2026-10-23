import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NAV, NAV_ITEMS, navItemForPath } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { Kbd } from "@/components/neo";

/**
 * The naked sidebar: grouped rows, no border, no background. Below `lg` it
 * is a drawer the topbar menu button opens; `onNavigate` lets the shell
 * close it after a pick.
 */
export function AppNav({ onNavigate }: { onNavigate?: () => void }) {
	const location = useLocation();
	const current = navItemForPath(location.pathname);
	useJumpShortcuts();
	return (
		<>
			{NAV.map((group) => (
				<div key={group.heading} className="neo-nav-group">
					<div className="neo-nav-heading">{group.heading}</div>
					{group.items.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className="neo-nav-row group"
							data-active={current?.to === item.to}
							aria-current={current?.to === item.to ? "page" : undefined}
							data-planned={item.planned || undefined}
							onClick={onNavigate}
							title={item.planned ? `${item.label} — planned, not built yet` : item.label}
						>
							<item.icon size={15} />
							<span className="neo-nav-row-label">{item.label}</span>
							{item.planned ? (
								<span className="neo-nav-row-count" aria-label="planned">
									soon
								</span>
							) : (
								<span className="hidden text-[10.5px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 lg:inline">
									G {item.hotkey.toUpperCase()}
								</span>
							)}
						</Link>
					))}
				</div>
			))}
			<NavFoot />
		</>
	);
}

/** Footer card: the engine state at a glance, plus the shortcut legend. */
function NavFoot() {
	const backend = useStore((s) => s.backend);
	const label = backend ? `NeoPi ${backend.version ?? backend.commit?.slice(0, 7) ?? ""}`.trim() : "No engine attached";
	return (
		<div className="neo-sidebar-foot">
			<div className="flex items-center gap-2 text-ink-2">
				<span className="neo-dot" data-tone={backend ? "live" : "warn"} data-pulse={backend ? "true" : undefined} />
				<span className="truncate">{label}</span>
			</div>
			<div className="flex items-center gap-1">
				<Kbd>G</Kbd>
				<span>then a letter to jump</span>
			</div>
		</div>
	);
}

/** `g` then a letter jumps to a page, like NeoPi's `/stats`. Ignored while typing. */
function useJumpShortcuts(): void {
	const navigate = useNavigate();
	useEffect(() => {
		let armed = 0;
		function onKey(e: KeyboardEvent): void {
			const target = e.target as HTMLElement | null;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
			const now = Date.now();
			if (e.key === "g" || e.key === "G") {
				armed = now;
				return;
			}
			if (armed && now - armed < 1200) {
				const key = e.key.toLowerCase();
				const item = NAV_ITEMS.find((i) => i.hotkey === key);
				armed = 0;
				if (item) {
					e.preventDefault();
					navigate(item.to);
				}
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate]);
}
