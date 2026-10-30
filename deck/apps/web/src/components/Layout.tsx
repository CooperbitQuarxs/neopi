import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Eye, EyeOff, FoldVertical, Menu, Mic, Moon, PanelLeft, PanelRight, Sun, UnfoldVertical, UserRound, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { navItemForPath } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { AppNav } from "./AppNav";
import { BrandLockup } from "./BrandLockup";
import { EngineChip } from "./EngineChip";
import { NeoButton, NeoLinkButton } from "./neo";

interface Props {
	/** View-local column (sessions, filters, routine list). `null` hides it and its toggle. */
	sidebar: ReactNode;
	main: ReactNode;
	/** View-local right column. `null` hides it and its toggle. */
	inspector: ReactNode;
	/** Status content shown in the topbar beside the brand (chat's status bar). */
	topBar?: ReactNode;
	/** Extra topbar actions a view owns (chat's tool-card toggles). */
	tools?: ReactNode;
}

/**
 * The shell: glass topbar, naked grouped navigation, one inset panel. The
 * panel holds the view's own three columns (sidebar · main · inspector), so
 * every existing view keeps its layout and only the frame changed.
 *
 * Below `lg` the navigation and both view columns become overlays.
 */
export function Layout({ sidebar, main, inspector, topBar, tools }: Props) {
	const location = useLocation();
	const page = navItemForPath(location.pathname)?.label;
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const setSidebarOpen = useStore((s) => s.setSidebarOpen);
	const inspectorOpen = useStore((s) => s.inspectorOpen);
	const setInspectorOpen = useStore((s) => s.setInspectorOpen);
	const [navOpen, setNavOpen] = useState(false);
	const hasSidebar = sidebar !== null && sidebar !== undefined;
	const hasInspector = inspector !== null && inspector !== undefined;

	// Esc closes overlays on small screens.
	useEffect(() => {
		function onKey(e: KeyboardEvent): void {
			if (e.key !== "Escape") return;
			setNavOpen(false);
			if (window.innerWidth < 1024) {
				setSidebarOpen(false);
				setInspectorOpen(false);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [setSidebarOpen, setInspectorOpen]);

	// Route changes close the mobile navigation drawer.
	useEffect(() => setNavOpen(false), [location.pathname]);

	const showPanelScrim = (hasSidebar && sidebarOpen) || (hasInspector && inspectorOpen);

	return (
		<div className="relative flex h-full w-full flex-col bg-paper text-ink">
			<div className="neo-ambient" />
			<header className="neo-topbar">
				<NeoButton variant="ghost" icon className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
					<Menu size={16} />
				</NeoButton>
				<BrandLockup page={page} />
				{topBar ? <div className="hidden min-w-0 truncate md:block">{topBar}</div> : null}
				<div className="neo-topbar-actions">
					{tools}
					{hasSidebar ? (
						<NeoButton variant="ghost" icon on={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle side column" title="Toggle side column">
							<PanelLeft size={16} />
						</NeoButton>
					) : null}
					{hasInspector ? (
						<NeoButton variant="ghost" icon on={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)} aria-label="Toggle inspector" title="Toggle inspector">
							<PanelRight size={16} />
						</NeoButton>
					) : null}
					<span className="hidden sm:inline-flex">
						<EngineChip />
					</span>
					<DictationButton />
					<ThemeToggle />
					<NeoLinkButton to="/legacy/people" variant="ghost" icon aria-label="You (accounts are planned)" title="You — accounts are planned">
						<UserRound size={16} />
					</NeoLinkButton>
				</div>
			</header>

			<div className="relative flex min-h-0 flex-1">
				{navOpen ? <button type="button" className="neo-scrim lg:hidden" aria-label="Close navigation" onClick={() => setNavOpen(false)} /> : null}
				<nav
					className={cn(
						"neo-sidebar absolute inset-y-0 left-0 z-[70] w-[260px] bg-paper transition-transform duration-200 ease-out lg:static lg:z-30 lg:w-[var(--sidebar-w)] lg:translate-x-0 lg:bg-transparent",
						navOpen ? "translate-x-0 shadow-[var(--neo-shadow-3)]" : "-translate-x-[102%]",
					)}
					aria-label="Pages"
				>
					<div className="flex items-center justify-between px-2 pb-1 lg:hidden">
						<span className="neo-nav-heading pb-0">Pages</span>
						<NeoButton variant="ghost" icon size="sm" onClick={() => setNavOpen(false)} aria-label="Close navigation">
							<X size={14} />
						</NeoButton>
					</div>
					<AppNav onNavigate={() => setNavOpen(false)} />
				</nav>

				<main className="neo-panel ml-2 lg:ml-0">
					{showPanelScrim ? (
						<button
							type="button"
							className="absolute inset-0 z-20 bg-ink/20 backdrop-blur-[1px] lg:hidden"
							aria-label="Close panels"
							onClick={() => {
								setSidebarOpen(false);
								setInspectorOpen(false);
							}}
						/>
					) : null}

					{hasSidebar ? (
						<aside
							className={cn(
								"absolute inset-y-0 left-0 z-30 w-[280px] max-w-[80%] border-r border-line bg-paper-code",
								"transform transition-transform duration-200 ease-out",
								sidebarOpen ? "translate-x-0" : "-translate-x-full",
								"lg:static lg:max-w-none lg:translate-x-0 lg:transition-[width]",
								sidebarOpen ? "lg:w-[240px]" : "lg:w-0 lg:border-r-0",
								"lg:overflow-hidden",
							)}
							aria-hidden={!sidebarOpen}
						>
							<div className="flex h-full w-[280px] flex-col lg:w-[240px]">
								<MobileCloseBar onClose={() => setSidebarOpen(false)} />
								<div className="min-h-0 flex-1">{sidebar}</div>
							</div>
						</aside>
					) : null}

					<div className="relative flex min-w-0 flex-1 flex-col">{main}</div>

					{hasInspector ? (
						<aside
							className={cn(
								"absolute inset-y-0 right-0 z-30 w-[300px] max-w-[85%] border-l border-line bg-paper-code",
								"transform transition-transform duration-200 ease-out",
								inspectorOpen ? "translate-x-0" : "translate-x-full",
								"lg:static lg:max-w-none lg:translate-x-0 lg:transition-[width]",
								inspectorOpen ? "lg:w-[280px]" : "lg:w-0 lg:border-l-0",
								"lg:overflow-hidden",
							)}
							aria-hidden={!inspectorOpen}
						>
							<div className="flex h-full w-[300px] flex-col lg:w-[280px]">
								<MobileCloseBar onClose={() => setInspectorOpen(false)} label="Inspector" />
								<div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
							</div>
						</aside>
					) : null}
				</main>
			</div>
		</div>
	);
}

function MobileCloseBar({ onClose, label }: { onClose: () => void; label?: string }) {
	return (
		<div className="flex h-9 items-center border-b border-line px-2 lg:hidden">
			<NeoButton variant="ghost" icon size="sm" onClick={onClose} aria-label="Close">
				<X size={14} />
			</NeoButton>
			{label ? <span className="ml-2 text-xs text-ink-3">{label}</span> : null}
		</div>
	);
}

/** Neo ↔ Neo light. Legacy themes jump back into Neo on first press. */
function ThemeToggle() {
	const { active, set } = useTheme();
	const light = active === "neo-light" || active === "paper";
	return (
		<NeoButton variant="ghost" icon onClick={() => set(light ? "neo" : "neo-light")} aria-label={light ? "Switch to dark" : "Switch to light"} title={light ? "Dark" : "Light"}>
			{light ? <Moon size={16} /> : <Sun size={16} />}
		</NeoButton>
	);
}

/**
 * Dictation everywhere is part of the vision and not wired yet. The button
 * is in the chrome so the affordance is visible; it opens the NeoPi page
 * where the plan (xAI STT with a local Parakeet fallback) is written down.
 */
function DictationButton() {
	return (
		<NeoLinkButton to="/settings#dictation" variant="ghost" icon aria-label="Dictation (planned)" title="Dictation — planned, not wired yet">
			<Mic size={16} />
		</NeoLinkButton>
	);
}

/* Chat-owned topbar tools. Exported so ChatView passes them through `tools`. */

export function ToolCardsToggle() {
	const allCollapsed = useStore((s) => s.toolView.allCollapsed);
	const toolCallsHidden = useStore((s) => s.toolCallsHidden);
	const toggle = useStore((s) => s.toggleAllToolCards);
	const Icon = allCollapsed ? UnfoldVertical : FoldVertical;
	const label = toolCallsHidden ? "Tool calls are hidden" : allCollapsed ? "Expand all tool cards" : "Collapse all tool cards";
	return (
		<NeoButton variant="ghost" icon on={allCollapsed} onClick={toggle} disabled={toolCallsHidden} aria-label={label} title={label}>
			<Icon size={16} />
		</NeoButton>
	);
}

/** Chat-only display mode: prose with running tools as one-line rows (#62). */
export function ToolCallsHiddenToggle() {
	const hidden = useStore((s) => s.toolCallsHidden);
	const setHidden = useStore((s) => s.setToolCallsHidden);
	const Icon = hidden ? EyeOff : Eye;
	const label = hidden ? "Show tool calls" : "Hide tool calls";
	return (
		<NeoButton variant="ghost" icon on={hidden} onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label={label} title={label}>
			<Icon size={16} />
		</NeoButton>
	);
}
