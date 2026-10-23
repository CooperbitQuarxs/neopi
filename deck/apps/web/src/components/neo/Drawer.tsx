/**
 * Right-side glass sheet over a scrim, portalled to `document.body`, as in
 * `/stats`' request and span drawers. Esc and scrim clicks close it; focus
 * returns to the opener. A `footer` pins actions (Save, Delete) to the
 * bottom so forms inside never hide their buttons below the fold.
 */
import { X } from "lucide-react";
import { type CSSProperties, type ReactNode, useId, useRef } from "react";
import { NeoModalScope, NeoPortal, useNeoLayer, useNeoOverlay } from "./overlays";
import { NeoButton } from "./primitives";

export interface DrawerProps {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	subtitle?: ReactNode;
	/** Header controls left of the close button. */
	actions?: ReactNode;
	footer?: ReactNode;
	/** Sheet width in px. Default 560. */
	width?: number;
	children: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, actions, footer, width, children }: DrawerProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const titleId = useId(), subtitleId = useId();
	const layer = useNeoLayer(true);
	useNeoOverlay({ open, onClose, panelRef, modal: true });

	if (!open) return null;
	return <NeoPortal><NeoModalScope>
			<div className="neo-drawer-scrim" style={layer} role="presentation" />
			<div ref={panelRef} className="neo-drawer neo-modal-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle !== undefined ? subtitleId : undefined} tabIndex={-1} style={{ ...layer, zIndex: `calc(${layer.zIndex} + 1)`, ...(width !== undefined ? { "--drawer-w": `${width}px` } : {}) } as CSSProperties}>
				<header className="neo-drawer-header">
					<div className="neo-drawer-titles">
						<h2 id={titleId} className="neo-drawer-title">{title}</h2>
						{subtitle !== undefined && <div id={subtitleId} className="neo-drawer-subtitle">{subtitle}</div>}
					</div>
					{actions}
					<NeoButton variant="ghost" icon onClick={onClose} aria-label="Close">
						<X size={16} />
					</NeoButton>
				</header>
				<div className="neo-drawer-body">{children}</div>
				{footer !== undefined && <footer className="neo-drawer-footer">{footer}</footer>}
			</div>
		</NeoModalScope></NeoPortal>;
}

/** Small-caps-free section label inside drawers and cards (`Timing`, `Tokens`). */
export function SectionLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
	return (
		<div className="neo-section-label">
			<span>{children}</span>
			{actions}
		</div>
	);
}
