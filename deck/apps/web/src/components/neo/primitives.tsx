/**
 * Neo primitives: thin React wrappers over the `.neo-*` classes in
 * `src/neo.css`. They exist so pages compose the NeoPi web language by name
 * (Card, Stat, Badge) instead of by class string, and so measurements stay in
 * one place. See docs/design/neo-design-language.md.
 */
import { Construction as ConstructionIcon, type LucideIcon } from "lucide-react";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Page */

export interface PageHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	/** Shown after the title, e.g. a `planned` badge. */
	badge?: ReactNode;
}

export function PageHeader({ title, description, actions, badge }: PageHeaderProps) {
	return (
		<header className="neo-page-header neo-rise">
			<div className="min-w-0">
				<h1 className="neo-page-title">
					<span>{title}</span>
					{badge}
				</h1>
				{description !== undefined && <p className="neo-page-description">{description}</p>}
			</div>
			{actions !== undefined && <div className="neo-page-actions">{actions}</div>}
		</header>
	);
}

export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("neo-page", className)} {...rest} />;
}

/* ---------------------------------------------------------------- Card */

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	footer?: ReactNode;
	/** Body without padding, for full-bleed tables and lists. */
	flush?: boolean;
	/** Entrance stagger index. */
	index?: number;
	tone?: "accent";
	interactive?: boolean;
	bodyClassName?: string;
}

export function Card({ title, description, actions, footer, flush, index, tone, interactive, className, bodyClassName, children, ...rest }: CardProps) {
	const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
	return (
		<section
			className={cn("neo-card neo-rise", className)}
			style={index !== undefined ? ({ "--i": index } as CSSProperties) : undefined}
			data-tone={tone}
			data-interactive={interactive || undefined}
			{...rest}
		>
			{hasHeader && (
				<header className="neo-card-header">
					<div className="neo-card-titles">
						{title !== undefined && <h2 className="neo-card-title">{title}</h2>}
						{description !== undefined && <p className="neo-card-description">{description}</p>}
					</div>
					{actions !== undefined && <div className="neo-card-actions">{actions}</div>}
				</header>
			)}
			<div className={cn("neo-card-body", bodyClassName)} data-flush={flush ?? false}>
				{children}
			</div>
			{footer !== undefined && <footer className="neo-card-footer">{footer}</footer>}
		</section>
	);
}

/* ---------------------------------------------------------------- Stat */

export interface StatProps {
	label: ReactNode;
	value: ReactNode;
	foot?: ReactNode;
	size?: "sm";
	/** Route to navigate to when the stat is clicked. */
	to?: string;
	icon?: LucideIcon;
}

export function StatGrid({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
	return (
		<div className={cn("neo-stat-grid neo-rise", className)} style={style}>
			{children}
		</div>
	);
}

export function Stat({ label, value, foot, size, to, icon: Icon }: StatProps) {
	const body = (
		<>
			<div className="neo-stat-label">
				{Icon && <Icon size={13} />}
				{label}
			</div>
			<div className="neo-stat-value">{value}</div>
			{foot !== undefined && <div className="neo-stat-foot">{foot}</div>}
		</>
	);
	if (to) {
		return (
			<Link to={to} className="neo-stat" data-size={size}>
				{body}
			</Link>
		);
	}
	return (
		<div className="neo-stat" data-size={size}>
			{body}
		</div>
	);
}

/* ---------------------------------------------------------------- Controls */

type NeoButtonVariant = "default" | "primary" | "accent" | "ghost" | "danger";

export interface NeoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: NeoButtonVariant;
	size?: "sm";
	icon?: boolean;
	/** Pressed/toggled state for ghost buttons. */
	on?: boolean;
}

export const NeoButton = forwardRef<HTMLButtonElement, NeoButtonProps>(function NeoButton(
	{ variant = "default", size, icon, on, className, type = "button", ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type={type}
			className={cn("neo-btn", className)}
			data-variant={variant === "default" ? undefined : variant}
			data-size={size}
			data-icon={icon || undefined}
			data-on={on || undefined}
			{...rest}
		/>
	);
});
export interface NeoLinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	to: string;
	variant?: NeoButtonVariant;
	size?: "sm";
	icon?: boolean;
}

export function NeoLinkButton({ to, variant = "default", size, icon, className, children, ...rest }: NeoLinkButtonProps) {
	return (
		<Link to={to} className={cn("neo-btn", className)} data-variant={variant === "default" ? undefined : variant} data-size={size} data-icon={icon || undefined} {...rest}>
			{children}
		</Link>
	);
}

export interface SegmentedOption<T extends string> {
	value: T;
	label: ReactNode;
	title?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label, disabled = false }: { options: readonly SegmentedOption<T>[]; value: T; onChange: (value: T) => void; label?: string; disabled?: boolean }) {
	const selected = options.findIndex(option => option.value === value);
	return (
		<div className="neo-segmented" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={event => {
			if (disabled || event.altKey || event.ctrlKey || event.metaKey || !options.length) return;
			const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
			const index = buttons.indexOf(event.target as HTMLButtonElement);
			if (index < 0) return;
			const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
			let next: number;
			if (event.key === "Home") next = 0;
			else if (event.key === "End") next = options.length - 1;
			else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + (event.key === "ArrowRight" && rtl ? -1 : 1) + options.length) % options.length;
			else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + (event.key === "ArrowLeft" && rtl ? 1 : -1) + options.length) % options.length;
			else return;
			event.preventDefault();
			onChange(options[next]!.value);
			buttons[next]?.focus();
		}}>
			{options.map((option, index) => (
				<button
					key={option.value}
					type="button"
					role="radio"
					aria-checked={option.value === value}
					disabled={disabled}
					tabIndex={index === (selected < 0 ? 0 : selected) ? 0 : -1}
					title={option.title}
					className="neo-segmented-option"
					data-active={option.value === value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="neo-kbd">{children}</kbd>;
}

/* ---------------------------------------------------------------- Badge & dot */

export type NeoTone = "ok" | "warn" | "bad" | "accent" | "planned";

export function NeoBadge({ tone, mono, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: NeoTone; mono?: boolean }) {
	return <span className={cn("neo-badge", className)} data-tone={tone} data-mono={mono || undefined} {...rest} />;
}

export function Dot({ tone, pulse, className }: { tone?: "ok" | "live" | "warn" | "bad" | "accent"; pulse?: boolean; className?: string }) {
	return <span className={cn("neo-dot", className)} data-tone={tone} data-pulse={pulse || undefined} aria-hidden="true" />;
}

export function PlannedBadge({ children = "planned" }: { children?: ReactNode }) {
	return <NeoBadge tone="planned">{children}</NeoBadge>;
}

/* ---------------------------------------------------------------- States */

export function Empty({ icon: Icon, title, hint, action }: { icon?: LucideIcon; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
	return (
		<div className="neo-empty">
			{Icon && <Icon size={22} />}
			<div className="neo-empty-title">{title}</div>
			{hint !== undefined && <div className="neo-empty-hint">{hint}</div>}
			{action !== undefined && <div className="mt-2">{action}</div>}
		</div>
	);
}

/** The honest "not built yet" notice every planned area carries. */
export function Construction({ children }: { children: ReactNode }) {
	return (
		<div className="neo-construction neo-rise" role="note">
			<ConstructionIcon size={16} />
			<div className="min-w-0">{children}</div>
		</div>
	);
}

/* ---------------------------------------------------------------- Key/value */

export function KeyValue({ items }: { items: ReadonlyArray<{ key: ReactNode; value: ReactNode }> }) {
	return (
		<dl className="neo-kv">
			{items.map((item, i) => (
				<div key={i} className="neo-kv-item">
					<dt className="neo-kv-key">{item.key}</dt>
					<dd className="neo-kv-value">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}
