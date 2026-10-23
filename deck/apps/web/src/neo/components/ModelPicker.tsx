import { Check, ChevronDown, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NeoPopover, NeoSelect } from "@/components/neo";
import { cn } from "@/lib/utils";
import { type ModelTarget, type PickerCatalog, type PickerModel, providerLabel, splitPick, useCatalog, useHiddenProviders, useModelQuery } from "../client/models";
import "./model-picker.css";

export interface ModelPickerProps extends ModelTarget {
	value: string;
	onChange: (value: string) => void;
	above?: boolean;
	size?: "sm";
	className?: string;
	disabled?: boolean;
	/** A role cannot be assigned to itself in the configuration page. */
	excludeRole?: string;
}
export function ModelPicker({ value, onChange, above, size, className, disabled, sessionId, cwd, excludeRole }: ModelPickerProps) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const anchor = useRef<HTMLElement | null>(null);
	const [width, setWidth] = useState(1040);
	const { catalog, error } = useCatalog({ sessionId, cwd }, open);
	useLayoutEffect(() => {
		if (!open) return;
		const element = trigger.current?.closest<HTMLElement>(".neo-composer") ?? trigger.current;
		anchor.current = element;
		const update = () => setWidth(Math.min(window.innerWidth - 24, element?.classList.contains("neo-composer") ? element.getBoundingClientRect().width : 1080));
		update();
		const observer = new ResizeObserver(update);
		if (element) observer.observe(element);
		window.addEventListener("resize", update);
		return () => { observer.disconnect(); window.removeEventListener("resize", update); };
	}, [open]);
	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	return <div className={cn("neo-model-picker", className)}>
		<button ref={trigger} type="button" className="neo-model-trigger" data-size={size} aria-haspopup="dialog" aria-expanded={open} aria-label={`Choose model or role, ${value || "not selected"}`} title={value || "Choose a model or role"} disabled={disabled} onClick={() => setOpen(previous => !previous)}>
			<span>{value || "Choose model or role"}</span><ChevronDown size={12} />
		</button>
		<NeoPopover open={open} onClose={() => setOpen(false)} anchorRef={anchor} side={above ? "top" : "bottom"} width={width} className="neo-model-popover" autoFocus={false}>
			{open && <PickerSheet value={value} catalog={catalog} error={error} target={{ sessionId, cwd }} excludeRole={excludeRole} onClose={() => setOpen(false)} onPick={selector => { onChange(selector); setOpen(false); }} />}
		</NeoPopover>
	</div>;
}
const columns = ["Intelligence", "TTFT", "Tokens/s", "Context", "Input $/M", "Output $/M"];
function facts(item: PickerModel): string[] {
	const number = (value: number | null, format: (n: number) => string) => value !== null && Number.isFinite(value) && value >= 0 ? format(value) : "Unknown";
	return [
		number(item.facts.intelligence, String), number(item.facts.ttftMs, value => `${(value / 1000).toFixed(1)}s`),
		number(item.facts.tokensPerSecond, value => value.toLocaleString(undefined, { maximumFractionDigits: 1 })),
		number(item.facts.effectiveContextWindow, value => value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })),
		number(item.facts.inputCostPerMillion, value => `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`),
		number(item.facts.outputCostPerMillion, value => `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`),
	];
}
function PickerSheet({ value, catalog, error, target, excludeRole, onClose, onPick }: { value: string; catalog?: PickerCatalog; error: string | null; target: ModelTarget; excludeRole?: string; onClose: () => void; onPick: (value: string) => void }) {
	const id = useId();
	const search = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState("all");
	const [active, setActive] = useState(0);
	const initial = splitPick(value, catalog?.efforts ?? []);
	const [effort, setEffort] = useState<string | null>(null);
	const selectedEffort = effort ?? initial.effort;
	const native = useModelQuery(target, query);
	const hidden = useHiddenProviders();
	useEffect(() => { search.current?.focus(); }, []);
	const inventory = useMemo(() => catalog?.items.filter(item => !hidden.has(item.provider) && (item.available || item.role) && item.selector !== `@${excludeRole}`) ?? [], [catalog, hidden, excludeRole]);
	const matches = useMemo(() => native.result ? [...native.result.roles.map(item => ({ ...item, role: true, available: item.resolvedSelector !== null })), ...native.result.items.map(item => ({ ...item, role: false, available: true }))].filter(item => !hidden.has(item.provider) && item.selector !== `@${excludeRole}`) : native.unavailable ? inventory : [], [native.result, native.unavailable, inventory, hidden, excludeRole]);
	const rows = useMemo(() => matches.filter(item => group === "all" || (group === "roles" ? item.role : !item.role && item.provider === group)), [matches, group]);
	const groups = useMemo(() => [...new Set(inventory.filter(item => !item.role).map(item => item.provider))], [inventory]);
	const selectable = useMemo(() => rows.map((row, index) => row.available ? index : -1).filter(index => index >= 0), [rows]);
	const start = Math.max(0, Math.floor(scrollTop / 54) - 5);
	const visible = rows.slice(start, start + 24);
	useEffect(() => { setActive(rows.findIndex(row => row.available && row.selector === initial.selector)); }, [rows, initial.selector]);
	useEffect(() => {
		const element = list.current;
		if (!element || active < 0) return;
		const top = active * 54;
		if (top < element.scrollTop) element.scrollTop = top;
		else if (top + 54 > element.scrollTop + element.clientHeight) element.scrollTop = top + 54 - element.clientHeight;
	}, [active, rows]);
	useEffect(() => { if (list.current) list.current.scrollTop = 0; setScrollTop(0); }, [rows]);
	const current = inventory.find(item => item.selector === initial.selector);
	const activeRow = rows[active];
	function pick(item: PickerModel) { if (item.available) onPick(`${item.selector}${selectedEffort ? `:${selectedEffort}` : ""}`); }
	function onKey(event: KeyboardEvent<HTMLInputElement>) {
		let next: number | undefined;
		if (event.key === "ArrowDown") next = selectable.find(index => index > active) ?? selectable[0];
		else if (event.key === "ArrowUp") next = [...selectable].reverse().find(index => index < active) ?? selectable.at(-1);
		else if (event.key === "Home") next = selectable[0];
		else if (event.key === "End") next = selectable.at(-1);
		else if (event.key === "Enter") { event.preventDefault(); if (activeRow) pick(activeRow); return; }
		else return;
		event.preventDefault(); if (next !== undefined) setActive(next);
	}
	return <section className="neo-model-switcher" role="dialog" aria-label="Choose a model or role">
		<header className="neo-model-search"><Search size={16} aria-hidden="true" /><input ref={search} role="combobox" aria-label="Search models and roles" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={activeRow ? `${id}-${active}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(-1); }} onKeyDown={onKey} placeholder={native.unavailable ? "Native search unavailable on this backend" : "Search models, roles or a native pattern"} readOnly={native.unavailable} /><button type="button" onClick={onClose} aria-label="Close model picker"><X size={16} /></button></header>
		<div className="neo-model-body"><nav className="neo-model-providers" aria-label="Model groups">
			{[{ id: "all", label: "All models and roles" }, { id: "roles", label: "Roles" }, ...groups.map(provider => ({ id: provider, label: providerLabel(provider) }))].map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => { setGroup(item.id); search.current?.focus(); }}>{item.label}<span>{item.id === "all" ? matches.length : matches.filter(row => item.id === "roles" ? row.role : !row.role && row.provider === item.id).length}</span></button>)}
		</nav><div className="neo-model-results">
			{error ? <p className="neo-model-message" role="alert">Could not load models. {error}</p> : !catalog ? <p className="neo-model-message" role="status">Loading models…</p> : <>
				{native.unavailable && <p className="neo-model-message neo-model-warning" role="status">Native search requires a newer NeoPi backend. Browse the live catalogue below. Performance and effective context are unknown.</p>}
				{native.error && !native.unavailable && <p className="neo-model-message" role="alert">{native.error}</p>}
				{catalog.roleError && <p className="neo-model-message" role="alert">Roles could not load. {catalog.roleError}</p>}
				<div className="neo-model-table" aria-busy={native.pending}>
					<div className="neo-model-grid neo-model-columns" aria-hidden="true"><span>Provider / model</span>{columns.map(column => <span key={column}>{column}</span>)}</div>
					<div ref={list} className="neo-model-list" id={`${id}-list`} role="listbox" aria-label="Models and roles" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
						<div aria-hidden="true" style={{ height: start * 54 }} />
						{visible.map((item, offset) => { const index = start + offset; return <div id={`${id}-${index}`} role="option" aria-posinset={index + 1} aria-setsize={rows.length} aria-selected={initial.selector === item.selector} aria-disabled={!item.available} key={item.selector} className="neo-model-grid neo-model-row" data-active={index === active} onMouseMove={() => { if (item.available) setActive(index); }} onMouseDown={event => event.preventDefault()} onClick={() => pick(item)}>
							<div className="neo-model-identity"><span className="neo-model-selector">{initial.selector === item.selector && <Check size={12} />}{item.selector}</span><span title={item.description}>{item.role ? `${item.name} role, ${item.resolvedSelector ? `currently ${item.resolvedSelector}` : "no available model"}` : item.name}</span></div>
							{facts(item).map((fact, column) => <span key={columns[column]} title={`${columns[column]}: ${fact}${column === 2 && item.facts.performanceSource ? `, ${item.facts.performanceSource}` : ""}`} aria-label={`${columns[column]}: ${fact}`}>{fact}</span>)}
						</div>; })}
						<div aria-hidden="true" style={{ height: Math.max(0, rows.length - start - visible.length) * 54 }} />
					</div>
				</div>
				{!rows.length && !native.pending && !native.error && <p className="neo-model-message">{group === "roles" ? "No visible roles have an available model." : "No matching models or roles."}</p>}
				{native.pending && <p className="neo-model-message" role="status">Searching NeoPi…</p>}
			</>}
		</div></div>
		<footer className="neo-model-footer"><label>Effort<NeoSelect aria-label="Model effort" value={selectedEffort} onChange={event => setEffort(event.target.value)} size="sm"><option value="">Model or role default</option>{catalog?.efforts.filter(level => level !== "inherit").map(level => <option key={level} value={level}>{level}</option>)}</NeoSelect></label><span>{value && !current && catalog ? `Saved selection unavailable: ${value}` : "Choose a row to apply model and effort."}</span><Link to="/models" onClick={onClose}>Configure models</Link></footer>
	</section>;
}
