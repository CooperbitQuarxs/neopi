import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { NpiConfigSetting } from "@npi-deck/protocol";
import { Check, NeoButton, NeoSelect, Switch, NeoInput, NeoTextarea, NeoCombobox, Segmented } from "@/components/neo";

export type ConfigDraft = { dirty: false } | { dirty: true; value: unknown } | { dirty: true; entries: Record<string, unknown> } | { dirty: true; error: string };
type EditorProps = { setting: NpiConfigSetting; disabled: boolean; onChange: (draft: ConfigDraft) => void };
const CLEAN: ConfigDraft = { dirty: false };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string" && !entry.includes("\n"));

export function ConfigEditor(props: EditorProps) {
	const { setting } = props;
	switch (setting.type) {
		case "boolean": return <BooleanEditor {...props} />;
		case "enum": return <EnumEditor {...props} />;
		case "number": return <TextEditor {...props} numeric />;
		case "string": return <TextEditor {...props} />;
		case "array":
			if (setting.options || setting.items) return <ChoiceListEditor {...props} />;
			return isStringList(setting.value) && isStringList(setting.defaultValue) ? <StringListEditor {...props} /> : <JsonEditor {...props} />;
		case "record": return setting.secret ? <SecretRecordEditor {...props} /> : <RecordEditor {...props} />;
	}
}

function BooleanEditor({ setting, disabled, onChange }: EditorProps) {
	const [checked, setChecked] = useState(setting.value === true);
	return <div className="neo-settings-actions"><Switch label={setting.label} checked={checked} disabled={disabled} onChange={next => { setChecked(next); onChange(next === setting.value ? CLEAN : { dirty: true, value: next }); }} /><span className="neo-settings-description">{checked ? "On" : setting.value === null ? "Off, unset" : "Off"}</span></div>;
}

function EnumEditor({ setting, disabled, onChange }: EditorProps) {
	const [value, setValue] = useState(String(setting.value ?? ""));
	const labels = new Map(setting.options?.map(option => [option.value, option.label]));
	if (!disabled && setting.enumValues && setting.enumValues.length > 0 && setting.enumValues.length <= 4 && setting.enumValues.includes(value)) return <Segmented label={setting.label} value={value} options={setting.enumValues.map(option => ({ value: option, label: labels.get(option) ?? option }))} onChange={next => { setValue(next); onChange(next === setting.value ? CLEAN : { dirty: true, value: next }); }} />;
	return <NeoSelect mono aria-label={setting.label} value={value} disabled={disabled} onChange={event => { setValue(event.target.value); onChange(event.target.value === setting.value ? CLEAN : { dirty: true, value: event.target.value }); }}>
		{!(setting.enumValues ?? []).includes(value) && <option value={value}>{value || "Unset"}</option>}
		{(setting.enumValues ?? []).map(option => <option key={option} value={option}>{labels.get(option) && labels.get(option) !== option ? `${labels.get(option)} (${option})` : option}</option>)}
	</NeoSelect>;
}

/** Numbers remain text so NeoPi's own setting parser decides what is valid. */
function TextEditor({ setting, disabled, onChange, numeric = false }: EditorProps & { numeric?: boolean }) {
	const initial = setting.secret || setting.value === null ? "" : String(setting.value);
	const [text, setText] = useState(initial);
	const update = (next: string) => {
		setText(next);
		if ((numeric ? next.trim() : next) === initial) onChange(CLEAN);
		else if (numeric && next.trim() === "") onChange({ dirty: true, error: "Enter a number, or reset to default." });
		else onChange({ dirty: true, value: next });
	};
	const placeholder = setting.secret ? setting.configured ? "Configured; type to replace" : "Not set" : setting.value === null ? "Unset" : setting.runtimeOptions ? "Name provided at runtime" : undefined;
	if (!numeric && !setting.secret && (initial.includes("\n") || initial.length > 120)) return <NeoTextarea className="neo-source" aria-label={setting.label} rows={4} value={text} disabled={disabled} onChange={event => update(event.target.value)} />;
	if (!numeric && !setting.secret && setting.options) return <NeoCombobox aria-label={setting.label} value={text} onValueChange={update} options={setting.options} disabled={disabled} placeholder={placeholder} allowCustom />;
	return <NeoInput className="neo-settings-advanced-input" aria-label={setting.label} type={setting.secret ? "password" : "text"} autoComplete={setting.secret ? "off" : undefined} inputMode={numeric ? "decimal" : undefined} value={text} disabled={disabled} placeholder={placeholder} onChange={event => update(event.target.value)} />;
}

function ChoiceListEditor({ setting, disabled, onChange }: EditorProps) {
	const initial = Array.isArray(setting.value) ? setting.value.map(String) : [];
	const choices = setting.options ?? (setting.items ?? []).map(value => ({ value, label: value, description: undefined }));
	const [selected, setSelected] = useState(initial);
	const update = (next: string[]) => { setSelected(next); onChange(same(next, initial) ? CLEAN : { dirty: true, value: next }); };
	const label = (value: string) => choices.find(choice => choice.value === value)?.label ?? `${value} (unknown)`;
	if (setting.ordered || setting.items) {
		const remaining = choices.filter(choice => !selected.includes(choice.value));
		const move = (index: number, by: number) => { const next = [...selected]; const [entry] = next.splice(index, 1); if (entry === undefined) return; next.splice(index + by, 0, entry); update(next); };
		return <div className="neo-settings-advanced-editor">
			{selected.length === 0 && <p className="neo-settings-description">No entries.</p>}
			{selected.map((value, index) => <div className="neo-settings-advanced-list-row" key={value}>
				<span className="neo-mono neo-settings-description">{index + 1}</span><span className="neo-settings-advanced-grow neo-mono">{label(value)}</span>
				<NeoButton size="sm" icon variant="ghost" aria-label={`Move ${value} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></NeoButton>
				<NeoButton size="sm" icon variant="ghost" aria-label={`Move ${value} down`} disabled={disabled || index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></NeoButton>
				<NeoButton size="sm" icon variant="ghost" aria-label={`Remove ${value}`} disabled={disabled} onClick={() => update(selected.filter(entry => entry !== value))}><X size={12} /></NeoButton>
			</div>)}
			{remaining.length > 0 && <NeoSelect mono aria-label={`Add to ${setting.label}`} value="" disabled={disabled} onChange={event => { if (event.target.value) update([...selected, event.target.value]); }}><option value="">Add entry…</option>{remaining.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</NeoSelect>}
		</div>;
	}
	const unknown = selected.filter(value => !choices.some(choice => choice.value === value));
	return <div className="neo-settings-advanced-choices">{[...choices, ...unknown.map(value => ({ value, label: `${value} (unknown)`, description: undefined }))].map(choice => <Check key={choice.value} disabled={disabled} checked={selected.includes(choice.value)} title={choice.description} onChange={checked => update(checked ? [...selected, choice.value] : selected.filter(value => value !== choice.value))}>{choice.label}</Check>)}</div>;
}

function StringListEditor({ setting, disabled, onChange }: EditorProps) {
	const initial = setting.value as string[];
	const [text, setText] = useState(initial.join("\n"));
	return <NeoTextarea className="neo-source" aria-label={setting.label} rows={Math.min(8, Math.max(2, initial.length + 1))} placeholder="One entry per line" value={text} disabled={disabled} onChange={event => { setText(event.target.value); const next = event.target.value.split("\n").map(line => line.trim()).filter(Boolean); onChange(same(next, initial) ? CLEAN : { dirty: true, value: next }); }} />;
}

function parseJsonShape(text: string, shape: "array" | "object"): { value: unknown } | { error: string } {
	let value: unknown;
	try { value = JSON.parse(text); } catch (error) { return { error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
	const valid = shape === "array" ? Array.isArray(value) : typeof value === "object" && value !== null && !Array.isArray(value);
	return valid ? { value } : { error: shape === "array" ? "Expected a JSON array." : "Expected a JSON object." };
}

function JsonEditor({ setting, disabled, onChange }: EditorProps) {
	const initial = JSON.stringify(setting.value ?? (setting.type === "array" ? [] : {}), null, 2);
	const [text, setText] = useState(initial);
	return <NeoTextarea className="neo-source" aria-label={setting.label} rows={Math.min(14, Math.max(3, initial.split("\n").length))} value={text} disabled={disabled} onChange={event => { setText(event.target.value); if (event.target.value === initial) return onChange(CLEAN); const result = parseJsonShape(event.target.value, setting.type === "array" ? "array" : "object"); onChange("error" in result ? { dirty: true, error: result.error } : { dirty: true, value: result.value }); }} />;
}

/** Only entry/field names are visible. Send a partial entries patch, never replace a secret record. */
function SecretRecordEditor({ setting, disabled, onChange }: EditorProps) {
	const [removed, setRemoved] = useState<string[]>([]);
	const [key, setKey] = useState("");
	const [text, setText] = useState("");
	const report = (nextRemoved: string[], nextKey: string, nextText: string) => {
		const entries: Record<string, unknown> = Object.fromEntries(nextRemoved.map(name => [name, null]));
		const name = nextKey.trim();
		if (name || nextText.trim()) {
			if (!name) return onChange({ dirty: true, error: "Name the entry to update." });
			let value: unknown;
			try { value = JSON.parse(nextText); } catch { return onChange({ dirty: true, error: `Invalid JSON for ${name}.` }); }
			entries[name] = value;
		}
		onChange(Object.keys(entries).length ? { dirty: true, entries } : CLEAN);
	};
	return <div className="neo-settings-advanced-editor">
		{!setting.secretEntries?.length && <p className="neo-settings-description">No entries configured.</p>}
		{setting.secretEntries?.map(({ key: name, fields }) => {
			const gone = removed.includes(name);
			return <div className="neo-settings-advanced-list-row" key={name}><span className="neo-mono" style={{ textDecoration: gone ? "line-through" : undefined }}>{name}</span><span className="neo-settings-description neo-settings-advanced-grow">{fields.length ? `${fields.join(", ")}, values hidden` : "Value hidden"}</span><NeoButton variant="ghost" size="sm" disabled={disabled} onClick={() => { const next = gone ? removed.filter(entry => entry !== name) : [...removed, name]; setRemoved(next); report(next, key, text); }}>{gone ? "Keep" : "Remove"}</NeoButton></div>;
		})}
		<label className="neo-settings-field"><span className="neo-settings-description">Entry to add or update</span><NeoInput className="neo-input neo-settings-advanced-input" aria-label={`Entry name for ${setting.label}`} value={key} disabled={disabled} autoComplete="off" onChange={event => { setKey(event.target.value); report(removed, event.target.value, text); }} /></label>
		<label className="neo-settings-field"><span className="neo-settings-description">JSON fields to merge. A null field deletes that field; null deletes the entry.</span><NeoTextarea className="neo-source" aria-label={`Secret fields for ${setting.label}`} rows={3} value={text} disabled={disabled} autoComplete="off" spellCheck={false} placeholder='{"token": "replacement"}' onChange={event => { setText(event.target.value); report(removed, key, event.target.value); }} /></label>
	</div>;
}

type EntryKind = "text" | "list" | "json";
type Entry = { key: string; kind: EntryKind; text: string };
const kindOf = (value: unknown): EntryKind => typeof value === "string" ? "text" : isStringList(value) ? "list" : "json";
const entryText = (kind: EntryKind, value: unknown): string => kind === "text" ? String(value) : kind === "list" ? (value as string[]).join("\n") : JSON.stringify(value);
const entriesOf = (record: Record<string, unknown>): Entry[] => Object.entries(record).map(([key, value]) => { const kind = kindOf(value); return { key, kind, text: entryText(kind, value) }; });
function recordOf(entries: Entry[]): { value: Record<string, unknown> } | { error: string } {
	const value: Record<string, unknown> = {};
	for (const [index, entry] of entries.entries()) {
		const key = entry.key.trim();
		if (!key) return { error: `Row ${index + 1} needs a key.` };
		if (Object.hasOwn(value, key)) return { error: `Duplicate key: ${key}` };
		let parsed: unknown;
		if (entry.kind === "text") parsed = entry.text;
		else if (entry.kind === "list") parsed = entry.text.split("\n").map(line => line.trim()).filter(Boolean);
		else { try { parsed = JSON.parse(entry.text); } catch { return { error: `Invalid JSON for ${key}.` }; } }
		Object.defineProperty(value, key, { value: parsed, enumerable: true, configurable: true, writable: true });
	}
	return { value };
}

/** Record order is precedence. Preserve row order through both editor modes. */
function RecordEditor({ setting, disabled, onChange }: EditorProps) {
	const initial = (setting.value ?? {}) as Record<string, unknown>;
	const [entries, setEntries] = useState(() => entriesOf(initial));
	const [json, setJson] = useState<string | null>(null);
	const report = (result: { value: unknown } | { error: string }) => onChange("error" in result ? { dirty: true, error: result.error } : same(result.value, initial) ? CLEAN : { dirty: true, value: result.value });
	const update = (next: Entry[]) => { setEntries(next); report(recordOf(next)); };
	const edit = (index: number, patch: Partial<Entry>) => update(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
	const move = (index: number, by: number) => { const next = [...entries]; const [entry] = next.splice(index, 1); if (!entry) return; next.splice(index + by, 0, entry); update(next); };
	if (json !== null) {
		const parsed = parseJsonShape(json, "object");
		return <div className="neo-settings-advanced-editor"><NeoTextarea className="neo-source" aria-label={`${setting.label} JSON`} value={json} disabled={disabled} rows={Math.min(14, Math.max(3, json.split("\n").length))} onChange={event => { setJson(event.target.value); report(parseJsonShape(event.target.value, "object")); }} /><NeoButton size="sm" variant="ghost" disabled={disabled || "error" in parsed} onClick={() => { if ("value" in parsed) { setEntries(entriesOf(parsed.value as Record<string, unknown>)); setJson(null); } }}>Edit as rows</NeoButton></div>;
	}
	const current = recordOf(entries);
	return <div className="neo-settings-advanced-editor">
		{entries.length === 0 && <p className="neo-settings-description">Empty record.</p>}
		{entries.map((entry, index) => <div className="neo-settings-advanced-record" key={index}>
			<NeoInput className="neo-input neo-settings-advanced-input" aria-label={`Key for row ${index + 1} in ${setting.label}`} disabled={disabled} value={entry.key} placeholder="Key" onChange={event => edit(index, { key: event.target.value })} />
			<Segmented label={`Value type for ${entry.key || `row ${index + 1}`}`} value={entry.kind} disabled={disabled} onChange={kind => { const parsed = recordOf([entry]); const old = "value" in parsed ? parsed.value[entry.key.trim()] : undefined; const text = old !== undefined && kindOf(old) === kind ? entryText(kind, old) : kind === "json" && old !== undefined ? JSON.stringify(old) : ""; edit(index, { kind, text }); }} options={[{ value: "text", label: "Text" }, { value: "list", label: "List" }, { value: "json", label: "JSON" }]} />
			{entry.kind === "text" ? <NeoInput className="neo-input neo-settings-advanced-input" aria-label={`Value for ${entry.key || `row ${index + 1}`}`} value={entry.text} disabled={disabled} placeholder="Value" onChange={event => edit(index, { text: event.target.value })} /> : <NeoTextarea className="neo-source" aria-label={`Value for ${entry.key || `row ${index + 1}`}`} value={entry.text} rows={Math.min(6, Math.max(1, entry.text.split("\n").length))} disabled={disabled} placeholder={entry.kind === "list" ? "One entry per line" : "JSON value"} onChange={event => edit(index, { text: event.target.value })} />}
			<div className="neo-settings-actions"><NeoButton variant="ghost" size="sm" icon disabled={disabled || index === 0} aria-label={`Move row ${index + 1} up`} onClick={() => move(index, -1)}><ArrowUp size={12} /></NeoButton><NeoButton variant="ghost" size="sm" icon disabled={disabled || index === entries.length - 1} aria-label={`Move row ${index + 1} down`} onClick={() => move(index, 1)}><ArrowDown size={12} /></NeoButton><NeoButton variant="ghost" size="sm" icon disabled={disabled} aria-label={`Remove row ${index + 1}`} onClick={() => update(entries.filter((_, i) => i !== index))}><X size={12} /></NeoButton></div>
		</div>)}
		<div className="neo-settings-actions"><NeoButton size="sm" variant="ghost" disabled={disabled} onClick={() => update([...entries, { key: "", kind: entries[0]?.kind ?? "text", text: "" }])}>Add row</NeoButton><NeoButton size="sm" variant="ghost" disabled={disabled || "error" in current} onClick={() => { if ("value" in current) setJson(JSON.stringify(current.value, null, 2)); }}>Edit as JSON</NeoButton></div>
	</div>;
}
