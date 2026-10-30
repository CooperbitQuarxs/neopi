/**
 * The chrome both canvas inspectors share: a header with an icon, a title
 * and a kicker, the close button, and a scrolling body. `mode: "inline"`
 * makes it a flex sibling of the canvas (viewport >= 1100px); `mode:
 * "drawer"` pins it to the right edge over a scrim.
 */

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export type InspectorMode = "inline" | "drawer";

export function InspectorShell({
	mode,
	icon,
	iconTone,
	title,
	kicker,
	actions,
	onClose,
	ariaLabel,
	testId,
	children,
}: {
	mode: InspectorMode;
	icon: ReactNode;
	iconTone?: "engine" | "accent";
	title: ReactNode;
	kicker?: ReactNode;
	actions?: ReactNode;
	onClose: () => void;
	ariaLabel: string;
	testId?: string;
	children: ReactNode;
}): JSX.Element {
	// Esc closes the inspector. Bound at the document level so the canvas
	// keyboard layer doesn't need to know about it.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<aside
			data-testid={testId}
			data-mode={mode}
			aria-label={ariaLabel}
			className={
				mode === "inline"
					? "pointer-events-auto flex h-full w-[380px] shrink-0 flex-col border-l border-[var(--neo-line-1)] bg-[var(--neo-panel)]"
					: "neo-drawer pointer-events-auto fixed inset-y-2 right-2 z-30 flex w-[min(400px,92vw)] flex-col"
			}
		>
			<header className="flex items-center gap-10px gap-2.5 border-b border-[var(--neo-line-1)] px-4 py-3">
				<span className="neo-node-icon" data-tone={iconTone}>{icon}</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</div>
					{kicker !== undefined ? <div className="truncate text-[12px] text-ink-3">{kicker}</div> : null}
				</div>
				<div className="flex items-center gap-0.5">
					{actions}
					<button
						type="button"
						onClick={onClose}
						className="neo-btn"
						data-variant="ghost"
						data-size="sm"
						data-icon="true"
						aria-label="Close inspector"
						title="Close (Esc)"
					>
						<X size={14} />
					</button>
				</div>
			</header>
			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
		</aside>
	);
}
