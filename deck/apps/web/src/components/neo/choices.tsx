import { Check, ChevronDown, Search } from "lucide-react";
import { Children, Fragment, forwardRef, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NeoPopover } from "./overlays";

export interface NeoChoice { value: string; label: ReactNode; description?: string; disabled?: boolean; group?: string; }
function textOf(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
	return Children.toArray(node).map(child => isValidElement(child) ? textOf(child) : String(child)).join("");
}
function choicesOf(children: ReactNode, group?: string, disabled = false): NeoChoice[] {
	return Children.toArray(children).flatMap(node => {
		if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(node)) return [];
		if (node.type === Fragment) return choicesOf(node.props.children, group, disabled);
		if (node.type === "optgroup") return choicesOf(node.props.children, node.props.label, disabled || !!node.props.disabled);
		if (node.type !== "option") return [];
		return [{ value: String(node.props.value ?? textOf(node.props.children)), label: node.props.label ?? node.props.children, disabled: disabled || node.props.disabled, group }];
	});
}
function nextChoice(choices: readonly NeoChoice[], index: number, direction: number) {
	for (let offset = 1; offset <= choices.length; offset++) { const next = (index + direction * offset + choices.length) % choices.length; if (!choices[next]?.disabled) return next; }
	return -1;
}
function ChoiceRows({ options, value, active, id, onChoose, onActive }: { options: readonly NeoChoice[]; value: string; active: number; id: string; onChoose: (value: string) => void; onActive: (index: number) => void }) {
	useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id]);
	return <>{options.map((option, index) => <Fragment key={`${index}:${option.value}`}>
		{option.group && option.group !== options[index - 1]?.group && <div className="neo-choice-group" role="presentation">{option.group}</div>}
		<div id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className="neo-choice" data-active={active === index} data-disabled={option.disabled || undefined} onPointerMove={() => { if (!option.disabled) onActive(index); }} onMouseDown={event => event.preventDefault()} onClick={() => { if (!option.disabled) onChoose(option.value); }}><span className="neo-choice-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span><Check size={13} className="neo-choice-check" aria-hidden="true" style={{ visibility: option.value === value ? "visible" : "hidden" }}/></div>
	</Fragment>)}{!options.length && <div className="neo-choice-empty" role="presentation">No matches</div>}</>;
}

/** Change payload mirrors the value-bearing part used by Neo form fields. */
export interface NeoSelectChange { target: { value: string; name: string }; currentTarget: { value: string; name: string }; }
export interface NeoSelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "defaultValue" | "onChange" | "size"> {
	value?: string | number;
	defaultValue?: string | number;
	onChange?: (event: NeoSelectChange) => void;
	children?: ReactNode;
	options?: readonly NeoChoice[];
	size?: "sm";
	mono?: boolean;
	name?: string;
	required?: boolean;
	placeholder?: string;
}
/** A button/listbox select. Option children are declarations, never native popups. */
export const NeoSelect = forwardRef<HTMLButtonElement, NeoSelectProps>(function NeoSelect({ value: controlled, defaultValue, options, children, onChange, size, mono, name = "", required, placeholder = "Choose…", className, disabled, onKeyDown, onClick, ...rest }, ref) {
	const choices = options ?? choicesOf(children);
	const [internal, setInternal] = useState(String(defaultValue ?? choices.find(option => !option.disabled)?.value ?? ""));
	const value = String(controlled ?? internal);
	const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
	const anchorRef = useRef<HTMLButtonElement | null>(null), search = useRef({ text: "", time: 0 });
	const id = useId(), listId = `${id}-list`;
	const selected = choices.find(option => option.value === value);
	const selectedIndex = choices.findIndex(option => option.value === value && !option.disabled);
	const choose = (next: string) => { if (controlled === undefined) setInternal(next); const target = { value: next, name }; onChange?.({ target, currentTarget: target }); setOpen(false); anchorRef.current?.focus(); };
	const show = (last = false) => { if (disabled) return; setActive(selectedIndex >= 0 ? selectedIndex : nextChoice(choices, last ? 0 : -1, last ? -1 : 1)); setOpen(true); };
	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	useEffect(() => { if (open && (active >= choices.length || choices[active]?.disabled)) setActive(nextChoice(choices, -1, 1)); }, [choices, active, open]);
	return <><button {...rest} ref={node => { anchorRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} type="button" className={cn("neo-input neo-choice-trigger", className)} data-size={size} data-mono={mono || undefined} data-placeholder={!selected || undefined} role="combobox" aria-autocomplete="none" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-required={required || undefined} disabled={disabled} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (open) setOpen(false); else show(); } }} onKeyDown={event => {
		onKeyDown?.(event); if (event.defaultPrevented || event.nativeEvent.isComposing) return;
		if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); if (!open) show(event.key === "ArrowUp"); else setActive(nextChoice(choices, active, event.key === "ArrowUp" ? -1 : 1)); }
		else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setOpen(true); setActive(nextChoice(choices, event.key === "Home" ? -1 : 0, event.key === "Home" ? 1 : -1)); }
		else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open && active >= 0) { const option = choices[active]; if (option && !option.disabled) choose(option.value); } else show(); }
		else if (event.key === "Tab") setOpen(false);
		else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault(); const now = Date.now(), previous = search.current;
			const text = now - previous.time > 700 ? event.key : previous.text + event.key; search.current = { text, time: now };
			const query = /^(.)(\1)*$/i.test(text) ? event.key : text;
			for (let offset = 1; offset <= choices.length; offset++) { const index = ((open ? active : selectedIndex) + offset + choices.length) % choices.length; const option = choices[index]; if (option && !option.disabled && textOf(option.label).toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) { setActive(index); setOpen(true); break; } }
		}
	}}><span className="neo-choice-value">{selected?.label ?? (value || placeholder)}</span><ChevronDown size={13} aria-hidden="true"/></button>
		{name && <input type="hidden" name={name} value={value} disabled={disabled}/>}
		<NeoPopover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} autoFocus={false} role="listbox" id={listId} aria-label={rest["aria-label"] ?? "Choices"} aria-labelledby={rest["aria-labelledby"]} className="neo-choice-list" data-mono={mono || undefined}><ChoiceRows options={choices} value={value} active={active} id={listId} onActive={setActive} onChoose={choose}/></NeoPopover>
	</>;
});

export interface NeoComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
	value: string;
	onValueChange: (value: string) => void;
	options: readonly NeoChoice[];
	allowCustom?: boolean;
	mono?: boolean;
	size?: "sm";
}
export const NeoCombobox = forwardRef<HTMLInputElement, NeoComboboxProps>(function NeoCombobox({ value, onValueChange, options, allowCustom = false, mono, size, className, disabled, onKeyDown, onFocus, onBlur, ...rest }, ref) {
	const [query, setQuery] = useState(""), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
	const anchorRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement | null>(null);
	const id = useId(), listId = `${id}-list`;
	const selected = options.find(option => option.value === value);
	const filtered = query ? options.filter(option => `${textOf(option.label)} ${option.value} ${option.description ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : options;
	const choose = (next: string) => { onValueChange(next); setQuery(""); setOpen(false); inputRef.current?.focus(); };
	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	const key = (event: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event); if (event.defaultPrevented || event.nativeEvent.isComposing) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(nextChoice(filtered, open ? active : -1, event.key === "ArrowUp" ? -1 : 1)); }
		else if (open && (event.key === "Home" || event.key === "End") && event.altKey) { event.preventDefault(); setActive(nextChoice(filtered, event.key === "Home" ? -1 : 0, event.key === "Home" ? 1 : -1)); }
		else if (event.key === "Enter" && open) { event.preventDefault(); const option = filtered[active]; if (option && !option.disabled) choose(option.value); else if (allowCustom && query) choose(query); }
		else if (event.key === "Tab") { setOpen(false); setQuery(""); }
	};
	return <div ref={anchorRef} className={cn("neo-combobox", className)}><Search size={13} className="neo-combobox-icon" aria-hidden="true"/><input {...rest} ref={node => { inputRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} className="neo-input" data-mono={mono || undefined} data-size={size} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 && filtered[active] ? `${listId}-${active}` : undefined} autoComplete="off" disabled={disabled} value={open ? query : selected ? textOf(selected.label) : value} onChange={event => { setQuery(event.target.value); setActive(-1); setOpen(true); if (allowCustom) onValueChange(event.target.value); }} onFocus={event => { onFocus?.(event); setQuery(""); setActive(options.findIndex(option => option.value === value && !option.disabled)); setOpen(true); }} onBlur={event => { onBlur?.(event); if (!anchorRef.current?.contains(event.relatedTarget)) { setOpen(false); setQuery(""); } }} onKeyDown={key}/><NeoPopover open={open} onClose={() => { setOpen(false); setQuery(""); }} anchorRef={anchorRef} autoFocus={false} role="listbox" id={listId} aria-label={rest["aria-label"] ?? "Suggestions"} aria-labelledby={rest["aria-labelledby"]} className="neo-choice-list" data-mono={mono || undefined}><ChoiceRows options={filtered} value={value} active={active} id={listId} onActive={setActive} onChoose={choose}/></NeoPopover></div>;
});
