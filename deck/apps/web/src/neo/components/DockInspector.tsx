import "./dock-inspector.css";
import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Selection detail in the shell's sibling panel, without blocking the page. */
export function DockInspector({ title, subtitle, onClose, returnFocusSelector, footer, children }: {
	title: ReactNode; subtitle: string; onClose: () => void; returnFocusSelector: string; footer?: ReactNode; children: ReactNode;
}) {
	const [dock, setDock] = useState<HTMLElement | null>(null);
	const root = useRef<HTMLElement>(null);
	const titleId = useId();
	useLayoutEffect(() => { setDock(document.getElementById("neo-dock")); }, []);
	useLayoutEffect(() => {
		const node = root.current;
		if (!node) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		node.focus();
		return () => {
			const row = document.querySelector<HTMLElement>(returnFocusSelector);
			const target = row ?? opener;
			if (target?.isConnected) target.focus({ preventScroll: true });
		};
	}, [dock, returnFocusSelector]);
	if (!dock) return null;
	return createPortal(<section ref={root} className="neo-dock-inspector" tabIndex={-1} aria-labelledby={titleId} onKeyDown={event => {
		if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
		const overlay = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].some(element => element.getClientRects().length > 0);
		if (overlay) return;
		event.preventDefault();
		event.stopPropagation();
		onClose();
	}}>
		<header className="neo-dock-inspector-head"><div><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div><button type="button" className="neo-btn" data-variant="ghost" data-icon="true" aria-label="Close inspector" title="Close (Esc)" onClick={onClose}><X size={14} /></button></header>
		<div className="neo-dock-inspector-body">{children}</div>
		{footer && <footer className="neo-dock-inspector-foot">{footer}</footer>}
	</section>, dock);
}
