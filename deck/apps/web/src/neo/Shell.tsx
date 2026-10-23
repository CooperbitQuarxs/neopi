/** Shared chrome. Pages own the layout inside the inset panel. */
import { LogOut, Menu, Mic, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BrandLockup } from "@/components/BrandLockup";
import { EngineChip } from "@/components/EngineChip";
import { Kbd, NeoButton, NeoMenu } from "@/components/neo";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { auth, useAccount } from "./client/auth";
import { Avatar } from "./components/Avatar";
import { NAV, navItemForPath } from "./nav";
import { ShortcutProvider, useShortcutHelp } from "./shortcuts";
import "./shell.css";

const SIDEBAR_KEY = "neodeck.sidebar-collapsed";

export function Shell() {
	return <ShortcutProvider><ShellFrame /></ShortcutProvider>;
}

function ShellFrame() {
	const location = useLocation();
	const page = navItemForPath(location.pathname)?.label;
	const [navOpen, setNavOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(() => {
		try { return localStorage.getItem(SIDEBAR_KEY) === "true"; } catch { return false; }
	});
	const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 899px)").matches);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const mainRef = useRef<HTMLElement>(null);
	const dockRef = useRef<HTMLElement>(null);
	const focusedPath = useRef(location.pathname);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 899px)");
		const update = () => { setMobile(media.matches); setNavOpen(false); };
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	useEffect(() => {
		try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch { /* Storage may be unavailable. */ }
	}, [collapsed]);
	useEffect(() => {
		if (!mobile || !navOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		mainRef.current?.setAttribute("inert", "");
		dockRef.current?.setAttribute("inert", "");
		navRef.current?.querySelector<HTMLElement>("button, a")?.focus();
		const trap = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const items = navRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
			if (!items?.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (!first || !last) return;
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		document.addEventListener("keydown", trap);
		return () => {
			document.body.style.overflow = previousOverflow;
			mainRef.current?.removeAttribute("inert");
			dockRef.current?.removeAttribute("inert");
			document.removeEventListener("keydown", trap);
			toggleRef.current?.focus();
		};
	}, [mobile, navOpen]);
	useEffect(() => setNavOpen(false), [location.pathname]);
	useEffect(() => {
		if (focusedPath.current === location.pathname || (mobile && navOpen)) return;
		focusedPath.current = location.pathname;
		mainRef.current?.focus();
	}, [location.pathname, mobile, navOpen]);
	useEffect(() => {
		function onKey(e: KeyboardEvent): void {
			if (e.key === "Escape") setNavOpen(false);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="neo-shell relative flex h-full w-full flex-col bg-paper text-ink" data-collapsed={collapsed} data-nav-open={navOpen}>
			<div className="neo-ambient" />
			<header className="neo-topbar">
				<NeoButton ref={toggleRef} variant="ghost" icon onClick={() => mobile ? setNavOpen((open) => !open) : setCollapsed((hidden) => !hidden)} aria-label={mobile ? (navOpen ? "Close navigation" : "Open navigation") : (collapsed ? "Show sidebar" : "Hide sidebar")} aria-expanded={mobile ? navOpen : !collapsed} aria-controls="deck-navigation">
					<Menu size={16} />
				</NeoButton>
				<BrandLockup page={page} />
				<div className="neo-topbar-actions">
					<span className="hidden sm:inline-flex">
						<EngineChip />
					</span>
					<DictationButton />
					<ThemeToggle />
					<AccountChip />
				</div>
			</header>

			<div className="neo-workspace relative flex min-h-0 flex-1">
				{mobile && navOpen ? <button type="button" className="neo-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setNavOpen(false)} /> : null}
				<nav
					id="deck-navigation"
					ref={navRef}
					className="neo-sidebar"
					hidden={mobile ? !navOpen : collapsed}
					aria-label="Pages"
				>
					<div className="neo-mobile-nav-heading">
						<span className="neo-nav-heading pb-0">Pages</span>
						<NeoButton variant="ghost" icon size="sm" onClick={() => setNavOpen(false)} aria-label="Close navigation">
							<X size={14} />
						</NeoButton>
					</div>
					<SideNav />
				</nav>

				<main ref={mainRef} id="deck-content" className="neo-panel" tabIndex={-1}>
					<div className="relative flex min-w-0 flex-1 flex-col">
						<Outlet />
					</div>
				</main>
				<aside ref={dockRef} id="neo-dock" className="neo-panel neo-dock" aria-label="Inspector" />
			</div>
		</div>
	);
}

function SideNav() {
	const location = useLocation();
	const current = navItemForPath(location.pathname);
	return (
		<>
			{NAV.map((group) => (
				<div key={group.heading} className="neo-nav-group">
					<div className="neo-nav-heading">{group.heading}</div>
					{group.items.map((item) => (
						<Link key={item.to} to={item.to} className="neo-nav-row group" data-active={current?.to === item.to} aria-current={current?.to === item.to ? "page" : undefined} title={item.label}>
							<item.icon size={15} />
							<span className="neo-nav-row-label">{item.label}</span>
							<span className="hidden text-[10.5px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 lg:inline">G {item.hotkey.toUpperCase()}</span>
						</Link>
					))}
				</div>
			))}
			<ShortcutFoot />
		</>
	);
}

/** Teach the same contract on every page. */
function ShortcutFoot() {
	const showHelp = useShortcutHelp();
	return (
		<div className="neo-sidebar-foot" aria-label="Keyboard shortcuts">
			<div className="flex items-center gap-1">
				<Kbd>G</Kbd>
				<span>then a letter to jump</span>
			</div>
			<div className="flex items-center justify-between"><span>Search this page</span><Kbd>/</Kbd></div>
			<button type="button" className="flex w-full items-center justify-between text-left" onClick={showHelp}><span>All shortcuts</span><Kbd>?</Kbd></button>
		</div>
	);
}

/** Signed-in identity and account actions. */
function AccountChip() {
	const account = useAccount();
	const navigate = useNavigate();
	if (!account) return null;
	return (
		<NeoMenu
			label="Account menu"
			trigger={
				<button type="button" className="neo-account-button" aria-label={`Account: ${account.name}`} title={`${account.name} (@${account.handle}) · ${account.role}`}>
					<Avatar account={account} size={20} />
					<span className="neo-account-name">{account.name}</span>
				</button>
			}
			items={[
				{ label: "Your usage", onSelect: () => navigate("/usage") },
				{ label: "Account", onSelect: () => navigate("/settings#accounts") },
				{ label: "Sign out", icon: <LogOut size={13} />, danger: true, onSelect: () => { void auth.logout().then(() => navigate("/login")); } },
			]}
		/>
	);
}

function ThemeToggle() {
	const { active, set } = useTheme();
	const light = active === "neo-light" || active === "paper";
	return (
		<NeoButton variant="ghost" icon onClick={() => set(light ? "neo" : "neo-light")} aria-label={light ? "Switch to dark" : "Switch to light"} title={light ? "Dark" : "Light"}>
			{light ? <Moon size={16} /> : <Sun size={16} />}
		</NeoButton>
	);
}

/** Dictation is part of every surface; the chip shows the state of the microphone for the page. */
function DictationButton() {
	const navigate = useNavigate();
	return (
		<NeoButton variant="ghost" icon aria-label="Dictation" title="Dictation: hold V in any text field" onClick={() => navigate("/settings#dictation")}>
			<Mic size={16} />
		</NeoButton>
	);
}


/** Boots the store (websocket, sessions) once the shell mounts behind the login gate. */
export function useDeckBootstrap(): void {
	const bootstrap = useStore((s) => s.bootstrap);
	useEffect(() => {
		void bootstrap();
	}, [bootstrap]);
}
