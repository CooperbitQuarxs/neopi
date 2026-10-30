import { X } from "lucide-react";
import { cloneElement, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { NeoButton } from "./primitives";
import "./overlays.css";

const ModalDepth = createContext(0);
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
function focusable(element: HTMLElement) {
	return Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.tabIndex >= 0 && !node.closest('[inert],[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0);
}
interface OverlayEntry {
	panel: RefObject<HTMLElement>;
	anchor?: RefObject<HTMLElement>;
	close: () => void;
	modal: boolean;
}
const stack: OverlayEntry[] = [];
let unlock: (() => void) | undefined;
function portalRoot() {
	let root = document.getElementById("neo-overlays");
	if (!root) { root = document.createElement("div"); root.id = "neo-overlays"; document.body.append(root); }
	return root;
}
function contains(entry: OverlayEntry, node: Node | null) {
	return !!node && (!!entry.panel.current?.contains(node) || !!entry.anchor?.current?.contains(node));
}
function modalScope() {
	let index = stack.length - 1;
	while (index >= 0 && !stack[index]?.modal) index--;
	return index < 0 ? [] : stack.slice(index);
}
function overlayKey(event: KeyboardEvent) {
	const top = stack.at(-1);
	if (!top || event.isComposing) return;
	if (event.key === "Escape") {
		event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); top.close();
		return;
	}
	const scope = modalScope();
	if (event.key !== "Tab" || !scope.length) return;
	const nodes = scope.flatMap(entry => entry.panel.current ? focusable(entry.panel.current) : []);
	const active = document.activeElement;
	const index = nodes.indexOf(active as HTMLElement);
	if (!nodes.length) { event.preventDefault(); scope[0]?.panel.current?.focus(); }
	else if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
	else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0]?.focus(); }
}
function overlayPointer(event: PointerEvent) {
	const top = stack.at(-1);
	if (top && !contains(top, event.target as Node)) top.close();
}
function overlayFocus(event: FocusEvent) {
	const top = stack.at(-1);
	if (top && !top.modal && !contains(top, event.target as Node)) top.close();
	const scope = modalScope();
	if (!scope.length || scope.some(entry => contains(entry, event.target as Node))) return;
	const panel = scope.at(-1)?.panel.current;
	if (panel) (focusable(panel)[0] ?? panel).focus();
}
function updateModalLock() {
	if (stack.some(entry => entry.modal) && !unlock) {
		const overflow = document.body.style.overflow;
		const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.id !== "neo-overlays" && !["SCRIPT", "STYLE", "LINK"].includes(node.tagName));
		const states = background.map(node => ({ node, inert: node.inert }));
		for (const { node } of states) node.inert = true;
		document.body.style.overflow = "hidden";
		unlock = () => { document.body.style.overflow = overflow; for (const { node, inert } of states) node.inert = inert; };
	} else if (!stack.some(entry => entry.modal) && unlock) { unlock(); unlock = undefined; }
}

/** All Neo overlays share dismissal ordering, focus scope, and one portal root. */
export function useNeoOverlay({ open, onClose, panelRef, anchorRef, modal = false, autoFocus = true }: { open: boolean; onClose: () => void; panelRef: RefObject<HTMLElement>; anchorRef?: RefObject<HTMLElement>; modal?: boolean; autoFocus?: boolean }) {
	const closeRef = useRef(onClose); closeRef.current = onClose;
	useLayoutEffect(() => {
		if (!open) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const entry: OverlayEntry = { panel: panelRef, anchor: anchorRef, close: () => closeRef.current(), modal };
		stack.push(entry);
		if (stack.length === 1) {
			window.addEventListener("keydown", overlayKey, true);
			document.addEventListener("pointerdown", overlayPointer, true);
			document.addEventListener("focusin", overlayFocus);
		}
		updateModalLock();
		const frame = requestAnimationFrame(() => {
			if (autoFocus && stack.at(-1) === entry && panelRef.current && !panelRef.current.contains(document.activeElement)) (focusable(panelRef.current)[0] ?? panelRef.current).focus();
		});
		return () => {
			cancelAnimationFrame(frame);
			const restore = document.activeElement === document.body || !!panelRef.current?.contains(document.activeElement);
			const index = stack.indexOf(entry); if (index >= 0) stack.splice(index, 1);
			updateModalLock();
			if (!stack.length) {
				window.removeEventListener("keydown", overlayKey, true);
				document.removeEventListener("pointerdown", overlayPointer, true);
				document.removeEventListener("focusin", overlayFocus);
			}
			if (restore && opener?.isConnected && !opener.closest("[inert]")) opener.focus();
		};
	}, [open, panelRef, anchorRef, modal, autoFocus]);
}

export function NeoPortal({ children }: { children: ReactNode }) { return createPortal(children, portalRoot()); }
export function useNeoLayer(modal = false): CSSProperties {
	const depth = useContext(ModalDepth);
	return { zIndex: modal ? `calc(var(--neo-layer-modal, 200) + ${depth * 20})` : depth ? `calc(var(--neo-layer-modal-popover, 210) + ${(depth - 1) * 20})` : "var(--neo-layer-popover, 100)" };
}

export interface NeoPopoverProps extends HTMLAttributes<HTMLDivElement> {
	open: boolean;
	onClose: () => void;
	anchorRef: RefObject<HTMLElement>;
	align?: "start" | "end";
	side?: "top" | "bottom";
	width?: number | string;
	autoFocus?: boolean;
}
export function NeoPopover({ open, onClose, anchorRef, align = "start", side = "bottom", width, autoFocus = true, className, style, children, ...rest }: NeoPopoverProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const layer = useNeoLayer();
	const [position, setPosition] = useState<CSSProperties>({});
	useNeoOverlay({ open, onClose, panelRef, anchorRef, autoFocus });
	useLayoutEffect(() => {
		if (!open) return;
		const positionPanel = () => {
			const anchor = anchorRef.current, panel = panelRef.current;
			if (!anchor || !panel) return;
			const rect = anchor.getBoundingClientRect();
			const viewport = window.visualViewport;
			const vx = viewport?.offsetLeft ?? 0, vy = viewport?.offsetTop ?? 0;
			const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
			const above = rect.top - vy - 14, below = vy + vh - rect.bottom - 14;
			const preferAbove = side === "top";
			const height = panel.scrollHeight;
			const topSide = preferAbove ? above >= height || above > below : below < height && above > below;
			const available = Math.max(40, topSide ? above : below);
			const renderedHeight = Math.min(panel.offsetHeight, available);
			const left = Math.max(vx + 8, Math.min(align === "end" ? rect.right - panel.offsetWidth : rect.left, vx + vw - panel.offsetWidth - 8));
			setPosition({ left, top: topSide ? Math.max(vy + 8, rect.top - renderedHeight - 6) : rect.bottom + 6, maxHeight: available, visibility: "visible", "--neo-anchor-width": `${rect.width}px` } as CSSProperties);
		};
		positionPanel();
		const observer = new ResizeObserver(positionPanel);
		if (anchorRef.current) observer.observe(anchorRef.current);
		if (panelRef.current) observer.observe(panelRef.current);
		window.addEventListener("resize", positionPanel);
		window.addEventListener("scroll", positionPanel, true);
		window.visualViewport?.addEventListener("resize", positionPanel);
		return () => { observer.disconnect(); window.removeEventListener("resize", positionPanel); window.removeEventListener("scroll", positionPanel, true); window.visualViewport?.removeEventListener("resize", positionPanel); };
	}, [open, anchorRef, align, side, width]);
	if (!open) return null;
	return <NeoPortal><div ref={panelRef} tabIndex={-1} className={cn("neo-popover", className)} style={{ ...position, width, ...style, ...layer }} {...rest}>{children}</div></NeoPortal>;
}

export interface NeoMenuItem { label: string; onSelect: () => void; icon?: ReactNode; disabled?: boolean; danger?: boolean; }
export interface NeoMenuProps { trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>; items: readonly NeoMenuItem[]; label?: string; align?: "start" | "end"; }
export function NeoMenu({ trigger, items, label = "Actions", align = "end" }: NeoMenuProps) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const id = useId();
	const search = useRef({ text: "", time: 0 });
	const initial = useRef("first");
	useEffect(() => {
		if (!open) return;
		const panel = document.getElementById(id);
		const nodes = panel ? focusable(panel) : [];
		(initial.current === "last" ? nodes.at(-1) : nodes[0])?.focus();
	}, [open, id]);
	return <>{cloneElement(trigger, { ref: anchorRef, "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": open ? id : undefined, onClick: event => { trigger.props.onClick?.(event); if (!event.defaultPrevented) { initial.current = "first"; setOpen(value => !value); } }, onKeyDown: event => { trigger.props.onKeyDown?.(event); if (!event.defaultPrevented && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); initial.current = event.key === "ArrowUp" ? "last" : "first"; setOpen(true); } } } as ButtonHTMLAttributes<HTMLButtonElement>)}
		<NeoPopover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align={align} autoFocus={false} className="neo-dropdown" id={id} role="menu" aria-label={label} onKeyDown={event => {
			const nodes = focusable(event.currentTarget);
			const index = nodes.indexOf(document.activeElement as HTMLElement);
			let next: number | undefined;
			if (event.key === "ArrowDown") next = (index + 1) % nodes.length;
			else if (event.key === "ArrowUp") next = (index - 1 + nodes.length) % nodes.length;
			else if (event.key === "Home") next = 0;
			else if (event.key === "End") next = nodes.length - 1;
			else if (event.key === "Tab") { setOpen(false); return; }
			else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
				const now = Date.now(); const previous = search.current;
				const text = now - previous.time > 700 ? event.key : previous.text + event.key;
				search.current = { text, time: now };
				const query = /^(.)(\1)*$/i.test(text) ? event.key : text;
				for (let offset = 1; offset <= nodes.length; offset++) { const candidate = (index + offset) % nodes.length; if (nodes[candidate]?.textContent?.trim().toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) { next = candidate; break; } }
			}
			if (next !== undefined) { event.preventDefault(); nodes[next]?.focus(); }
		}}>{items.map((item, index) => <button type="button" role="menuitem" className="neo-dropdown-item" data-danger={item.danger || undefined} disabled={item.disabled} key={`${index}:${item.label}`} onClick={() => { setOpen(false); anchorRef.current?.focus(); item.onSelect(); }}>{item.icon}<span>{item.label}</span></button>)}</NeoPopover>
	</>;
}

export interface NeoDialogProps { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; footer?: ReactNode; children: ReactNode; width?: number; }
export function NeoDialog({ open, onClose, title, description, footer, children, width = 520 }: NeoDialogProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const titleId = useId(), descriptionId = useId();
	const depth = useContext(ModalDepth), layer = useNeoLayer(true);
	useNeoOverlay({ open, onClose, panelRef, modal: true });
	if (!open) return null;
	return <NeoPortal><ModalDepth.Provider value={depth + 1}><div className="neo-dialog-backdrop" style={layer}><div className="neo-dialog" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} style={{ width }}><header className="neo-dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <div id={descriptionId} className="neo-dialog-description">{description}</div>}</div><NeoButton icon variant="ghost" aria-label="Close dialog" onClick={onClose}><X size={16}/></NeoButton></header><div className="neo-dialog-body">{children}</div>{footer && <footer className="neo-dialog-footer">{footer}</footer>}</div></div></ModalDepth.Provider></NeoPortal>;
}

/** Share modal nesting with drawers while keeping their existing layout. */
export function NeoModalScope({ children }: { children: ReactNode }) { const depth = useContext(ModalDepth); return <ModalDepth.Provider value={depth + 1}>{children}</ModalDepth.Provider>; }
