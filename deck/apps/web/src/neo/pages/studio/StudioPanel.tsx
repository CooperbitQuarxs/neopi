import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Studio's inspector. It renders into the shell's dock (#neo-dock), the inset
 * panel to the right of the page's panel, and only while something is being
 * worked on: a node, the graph's settings, its runs. With nothing open the
 * dock is empty, the shell hides it, and the canvas takes the width.
 */
export function StudioPanel({ title, subtitle, icon, onClose, footer, children }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
 const root = useRef<HTMLElement>(null);
 const [dock, setDock] = useState<HTMLElement | null>(null);
 /* The shell commits the dock in the same pass as the page, so look it up after mount. */
 useLayoutEffect(() => { setDock(document.getElementById("neo-dock")); }, []);
 /* Escape closes from anywhere in the panel that is not inside an open listbox, menu or dialog. */
 useEffect(() => {
  const node = root.current; if (!node) return;
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !(event.target as HTMLElement).closest("[role='listbox'], [role='menu'], [role='dialog']")) { event.preventDefault(); onClose(); } };
  node.addEventListener("keydown", key); return () => node.removeEventListener("keydown", key);
 }, [onClose, dock]);
 if (!dock) return null;
 return createPortal(<aside ref={root} className="neo-studio-panel" aria-label={typeof title === "string" ? title : "Inspector"}>
  <header className="neo-studio-panel-head">{icon}<div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="neo-btn" data-variant="ghost" data-icon="true" aria-label="Close panel" title="Close (Esc)" onClick={onClose}><X size={14} /></button></header>
  <div className="neo-studio-panel-body">{children}</div>
  {footer ? <footer className="neo-studio-panel-foot">{footer}</footer> : null}
 </aside>, dock);
}
