import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { NeoDialog } from "@/components/neo/overlays";
import { Kbd } from "@/components/neo/primitives";
import { NAV_ITEMS } from "./nav";

export interface PageShortcut {
	key: string;
	label: string;
	run: () => void;
}
export interface PageShortcuts {
	search?: RefObject<HTMLInputElement>;
	/** Reveal a collapsed search field before focusing it, when needed. */
	focusSearch?: () => void;
	shortcuts?: readonly PageShortcut[];
}
type Entry = { current: PageShortcuts };
const ShortcutContext = createContext<{ register: (entry: Entry) => () => void; showHelp: () => void } | null>(null);

/** Pages opt in with a search ref and any unmodified, single-key actions. */
export function usePageShortcuts(options: PageShortcuts, enabled = true): void {
	const context = useContext(ShortcutContext);
	const entry = useRef(options);
	entry.current = options;
	useLayoutEffect(() => enabled ? context?.register(entry) : undefined, [context, enabled]);
}
export function useShortcutHelp(): () => void {
	return useContext(ShortcutContext)?.showHelp ?? (() => {});
}

/** Keep shell and page actions behind the same editing and overlay guards. */
export function shortcutBlocked(event: KeyboardEvent): boolean {
	const target = event.target instanceof Element ? event.target : null;
	const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
	const overlay = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [data-neo-popover], .neo-popover, .neo-shell[data-nav-open="true"]')]
		.some(element => element.getClientRects().length > 0);
	return event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || !!editing || overlay;
}
function availableSearch(entry: PageShortcuts): boolean {
	const input = entry.search?.current;
	return !!entry.focusSearch || !!input && !input.disabled && input.getClientRects().length > 0;
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const entries = useRef(new Set<Entry>());
	const [helpOpen, setHelpOpen] = useState(false);
	const register = useCallback((entry: Entry) => { entries.current.add(entry); return () => { entries.current.delete(entry); }; }, []);
	const showHelp = useCallback(() => setHelpOpen(true), []);
	const context = useMemo(() => ({ register, showHelp }), [register, showHelp]);
	useEffect(() => {
		let armed = 0;
		let composing = false;
		const reset = () => { armed = 0; };
		const startComposition = () => { composing = true; reset(); };
		const endComposition = () => { composing = false; };
		function onKey(event: KeyboardEvent): void {
			if (composing || shortcutBlocked(event) || event.repeat) { reset(); return; }
			if (event.altKey) {
				reset();
				if (event.key.toLowerCase() === "m" && !event.shiftKey) { event.preventDefault(); navigate("/models"); }
				return;
			}
			if (event.key === "Escape") { reset(); return; }
			if (event.key === "?") { reset(); event.preventDefault(); showHelp(); return; }
			if (event.key === "/") {
				reset();
				const page = [...entries.current].map(entry => entry.current).find(availableSearch);
				if (page) { event.preventDefault(); if (page.focusSearch) page.focusSearch(); else page.search?.current?.focus(); }
				return;
			}
			const now = Date.now();
			if (armed && now - armed < 1200) {
				reset();
				const item = NAV_ITEMS.find(item => item.hotkey === event.key.toLowerCase());
				if (item) { event.preventDefault(); navigate(item.to); }
				return;
			}
			if (event.key.toLowerCase() === "g") { armed = now; return; }
			reset();
			const action = [...entries.current].flatMap(entry => entry.current.shortcuts ?? []).find(action => action.key.toLowerCase() === event.key.toLowerCase());
			if (action) { event.preventDefault(); action.run(); }
		}
		window.addEventListener("keydown", onKey);
		window.addEventListener("blur", reset);
		window.addEventListener("compositionstart", startComposition);
		window.addEventListener("compositionend", endComposition);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("blur", reset);
			window.removeEventListener("compositionstart", startComposition);
			window.removeEventListener("compositionend", endComposition);
		};
	}, [navigate, showHelp]);
	const pages = [...entries.current].map(entry => entry.current);
	const actions = pages.flatMap(page => page.shortcuts ?? []);
	const row = (key: string, label: string) => <div key={key} className="flex items-center justify-between gap-4 py-1"><span>{label}</span><Kbd>{key}</Kbd></div>;
	return <ShortcutContext.Provider value={context}>{children}<NeoDialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" description="Shortcuts pause while typing, composing text, or using an open menu or dialog.">
		<section aria-label="Global shortcuts">
			{row("?", "Show all shortcuts")}
			{row("/", pages.some(availableSearch) ? "Focus this page's search" : "Focus page search, where available")}
			{row("Escape", "Dismiss the current overlay or selection")}
			{row("Alt M", "Open Models")}
			{NAV_ITEMS.map(item => row(`G ${item.hotkey.toUpperCase()}`, `Go to ${item.label}`))}
		</section>
		{actions.length > 0 && <section aria-label="Page shortcuts" className="mt-4 border-t border-line pt-3"><h3 className="mb-2">On this page</h3>{actions.map(action => row(action.key, action.label))}</section>}
	</NeoDialog></ShortcutContext.Provider>;
}
