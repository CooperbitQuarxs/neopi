import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Pencil, RotateCcw } from "lucide-react";
import type { EnvEntry, ListEnvSettingsResponse } from "@npi-deck/protocol";
import { Empty, KeyValue, NeoBadge, NeoButton, Notice, SearchInput, Table, type Column, NeoInput, NeoCombobox } from "@/components/neo";
import { settings } from "../../client/settings";
import { AdvancedNotice, advancedError, useAdvancedNotice } from "./AdvancedNotice";

export function AdvancedEnvironment() {
	const [data, setData] = useState<ListEnvSettingsResponse | null>(null);
	const [query, setQuery] = useState("");
	const [editing, setEditing] = useState<string | null>(null);
	const [revealed, setRevealed] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [revealBusy, setRevealBusy] = useState<string | null>(null);
	const { message, notify } = useAdvancedNotice();
	const refresh = useCallback(async () => {
		setBusy(true);
		try { setData(await settings.engine.listEnv()); setFailed(false); setRevealed({}); }
		catch (error) { setFailed(true); notify(advancedError(error), "warn"); }
		finally { setBusy(false); }
	}, [notify]);
	useEffect(() => { void refresh(); }, [refresh]);
	async function reveal(entry: EnvEntry) {
		if (Object.hasOwn(revealed, entry.key)) { setRevealed(current => { const next = { ...current }; delete next[entry.key]; return next; }); return; }
		setRevealBusy(entry.key);
		try { const result = await settings.engine.revealEnv(entry.key); setRevealed(current => ({ ...current, [entry.key]: result.value })); }
		catch (error) { notify(advancedError(error), "warn"); }
		finally { setRevealBusy(null); }
	}
	async function save(entry: EnvEntry, value: string | null) {
		setBusy(true);
		try {
			const next = await settings.engine.patchEnv({ [entry.key]: value });
			setData(next); setEditing(null); setRevealed({});
			notify(next.appliedHot.includes(entry.key) ? "Saved and applied." : "Saved.");
		} catch (error) { notify(advancedError(error), "warn"); }
		finally { setBusy(false); }
	}
	async function restart() {
		setBusy(true);
		try { const result = await settings.engine.restartServer(); notify(result.message || "Restart scheduled."); }
		catch (error) { notify(advancedError(error), "warn"); }
		finally { setBusy(false); }
	}
	const needle = query.trim().toLowerCase();
	const visible = (data?.entries ?? []).filter(entry => [entry.key, entry.description, entry.source, entry.valueType].some(text => text.toLowerCase().includes(needle)));
	const columns: Column<EnvEntry>[] = [
		{ key: "key", header: "Variable", sort: entry => entry.key, width: "38%", wrap: true, render: entry => <div className="neo-settings-advanced-editor neo-settings-advanced-env-label"><span className="neo-mono neo-settings-advanced-env-key">{entry.key}</span><span className="neo-settings-description neo-settings-advanced-env-description" title={entry.description}>{entry.description}</span></div> },
		{ key: "value", header: "Value", wrap: true, render: entry => editing === entry.key
			? <EnvInlineEditor key={entry.key} entry={entry} busy={busy} onSave={value => void save(entry, value)} onCancel={() => setEditing(null)} />
			: <div className="neo-settings-advanced-env-value-row">
				<button type="button" className="neo-settings-advanced-value" title={revealed[entry.key] ?? entry.masked ?? "Unset"} aria-label={`Edit ${entry.key}`} disabled={busy} onClick={() => setEditing(entry.key)}>{revealed[entry.key] ?? entry.masked ?? "Unset"}</button>
				<NeoButton size="sm" variant="ghost" icon aria-label={`Edit ${entry.key}`} disabled={busy} onClick={() => setEditing(entry.key)}><Pencil size={12} /></NeoButton>
				{entry.sensitive && entry.isSet && <NeoButton size="sm" variant="ghost" icon disabled={revealBusy !== null} title={Object.hasOwn(revealed, entry.key) ? "Hide value" : "Reveal value"} aria-label={`${Object.hasOwn(revealed, entry.key) ? "Hide" : "Reveal"} ${entry.key}`} onClick={() => void reveal(entry)}>{Object.hasOwn(revealed, entry.key) ? <EyeOff size={13} /> : <Eye size={13} />}</NeoButton>}
			</div> },
		{ key: "source", header: "Source", sort: entry => entry.source, render: entry => <NeoBadge>{entry.source}</NeoBadge> },
		{ key: "type", header: "Type / apply", wrap: true, render: entry => <div className="neo-settings-actions"><span className="neo-settings-description">{entry.valueType}</span>{entry.sensitive && <NeoBadge>secret</NeoBadge>}{entry.restartRequired ? <NeoBadge tone="warn" title={entry.restartTarget === "telegram-bridge" ? "Restart the Telegram bridge to apply" : "Restart the server to apply"}>restart</NeoBadge> : <span className="neo-settings-description">{entry.hotApply ? "Hot apply" : "No restart"}</span>}</div> },
	];
	return <div className="neo-settings-stack">
		{data?.restartRequired && <div className="neo-settings-advanced-restart"><Notice tone="warn"><span className="neo-settings-advanced-heading"><span>Restart the server to apply pending environment changes.</span><NeoButton size="sm" disabled={busy} onClick={() => void restart()}><RotateCcw size={13} />Restart server</NeoButton></span></Notice></div>}
		<AdvancedNotice message={message} />
		<div className="neo-settings-advanced-heading"><p className="neo-settings-description">Edits write only to the managed .env. Values supplied by the launching process keep higher priority until removed there.</p><NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}><RotateCcw size={13} />Reload</NeoButton></div>
		{data ? <><div className="neo-settings-advanced-env-paths"><KeyValue items={[{ key: "Data directory", value: data.dataDir }, { key: "Managed environment", value: data.envFilePath }]} /></div><SearchInput pageSearch value={query} onChange={setQuery} placeholder="Search environment variables" aria-label="Search environment variables" /><Table className="neo-settings-advanced-env-table" dense columns={columns} rows={visible} rowKey={entry => entry.key} empty={<Empty title="No matching variables" hint="Search by variable name, description, source or type." />} /></> : <Empty title={failed ? "Could not load environment" : "Loading environment…"} hint={failed ? "Reload to try the live API again." : undefined} />}
	</div>;
}

function EnvInlineEditor({ entry, busy, onSave, onCancel }: { entry: EnvEntry; busy: boolean; onSave: (value: string | null) => void; onCancel: () => void }) {
	const [value, setValue] = useState(entry.sensitive || entry.source === "unset" ? "" : entry.masked);
	return <div className="neo-settings-advanced-editor">
		{entry.options && !entry.sensitive
			? <NeoCombobox aria-label={`New value for ${entry.key}`} value={value ?? ""} onValueChange={setValue} options={entry.options.map(option => ({value: option, label: option}))} disabled={busy} allowCustom autoFocus onKeyDown={event => { if (event.currentTarget.getAttribute("aria-expanded") === "true") return; if (event.key === "Escape") { event.preventDefault(); onCancel(); } if (event.key === "Enter" && !busy) { event.preventDefault(); onSave(value); } }} />
			: <NeoInput className="neo-settings-advanced-input" aria-label={`New value for ${entry.key}`} type={entry.sensitive ? "password" : "text"} autoComplete="off" value={value} disabled={busy} placeholder={entry.sensitive ? "Paste replacement" : entry.defaultValue ?? "Unset"} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } if (event.key === "Enter" && !busy) { event.preventDefault(); onSave(value); } }} autoFocus />}
		{entry.source === "process-env" && <p className="neo-settings-advanced-warning">The launching process still overrides this managed value, including after a server restart.</p>}
		{entry.options && <p className="neo-settings-description">Allowed: {entry.options.join(", ")}</p>}
		<div className="neo-settings-actions"><NeoButton size="sm" variant="primary" disabled={busy} onClick={() => onSave(value)}>Save</NeoButton><NeoButton size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</NeoButton><NeoButton size="sm" variant="danger" disabled={busy} onClick={() => onSave(null)}>Unset</NeoButton></div>
	</div>;
}
