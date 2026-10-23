/**
 * Filter-bar controls from `/stats`: the search field with a leading glyph,
 * underline tabs for in-card view switches, the toolbar row that holds them,
 * and the small form controls (select, check) the deck's settings pages
 * need in the same measurements.
 */
import { Search, X } from "lucide-react";
import { type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, forwardRef, useId, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePageShortcuts } from "@/neo/shortcuts";
import { NeoButton } from "./primitives";

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size"> {
	value: string;
	onChange: (value: string) => void;
	width?: number | string;
	/** Compact 26 px variant for card headers. */
	size?: "sm";
	/** Register this field as the current page's `/` search target. */
	pageSearch?: boolean;
}

/** Text filter with a leading search glyph and a clear button once there is text. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({ value, onChange, placeholder = "Filter…", width, size, className, pageSearch = false, ...rest }, ref) {
	const input = useRef<HTMLInputElement>(null);
	useImperativeHandle(ref, () => input.current!, []);
	usePageShortcuts({ search: input }, pageSearch);
	return (
		<label className={cn("neo-search", className)} style={width !== undefined ? { width } : undefined} data-size={size}>
			<Search size={14} />
			<input ref={input} className="neo-input" type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-size={size} {...rest} />
			{value !== "" && (
				<button type="button" className="neo-search-clear" aria-label="Clear" onClick={() => onChange("")}>
					<X size={12} />
				</button>
			)}
		</label>
	);
});

export interface TabOption<T extends string> {
	value: T;
	label: ReactNode;
	/** Dim count after the label. */
	count?: number | string;
	title?: string;
}

/** Underline tabs for switching the view inside a card or page. */
export function Tabs<T extends string>({ options, value, onChange, label, className }: { options: readonly TabOption<T>[]; value: T; onChange: (value: T) => void; label?: string; className?: string }) {
	return (
		<div className={cn("neo-tabs", className)} role="tablist" aria-label={label}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					role="tab"
					aria-selected={option.value === value}
					title={option.title}
					className="neo-tab"
					data-active={option.value === value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
					{option.count !== undefined && <span className="neo-tab-count">{option.count}</span>}
				</button>
			))}
		</div>
	);
}

/** One row of filters: search left, segmented/selects, anything pushed right with `end`. */
export function Toolbar({ children, end, className }: { children?: ReactNode; end?: ReactNode; className?: string }) {
	return (
		<div className={cn("neo-toolbar", className)}>
			{children}
			{end !== undefined && <div className="neo-toolbar-end">{end}</div>}
		</div>
	);
}

export const NeoInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "sm"; mono?: boolean }>(function NeoInput({ className, size, mono, ...rest }, ref) {
	return <input ref={ref} className={cn("neo-input", className)} data-size={size} data-mono={mono || undefined} {...rest}/>;
});

export const NeoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function NeoTextarea({ className, mono, ...rest }, ref) {
	return <textarea ref={ref} className={cn("neo-input", className)} data-mono={mono || undefined} {...rest}/>;
});

/** Checkbox with its label, 12.5 px, accent-coloured. */
export function Check({ checked, onChange, children, disabled, title, className }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; disabled?: boolean; title?: string; className?: string }) {
	const id = useId();
	return (
		<label htmlFor={id} className={cn("neo-check", className)} title={title} data-disabled={disabled || undefined}>
			<input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
			<span>{children}</span>
		</label>
	);
}

/** Switch-shaped boolean, for enable/disable rows in tables and lists. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) {
	return (
		<button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className="neo-switch" data-on={checked} disabled={disabled} onClick={() => onChange(!checked)}>
			<span className="neo-switch-knob" />
		</button>
	);
}

/** Back link used by detail pages (`← Sessions`). */
export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
	return (
		<NeoButton variant="ghost" size="sm" onClick={onClick} className="neo-back">
			<span aria-hidden="true">←</span> {children}
		</NeoButton>
	);
}
