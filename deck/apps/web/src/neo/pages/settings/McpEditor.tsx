import { type ReactNode, useState } from "react";
import { NeoBadge, NeoButton, Segmented, SectionLabel, NeoInput } from "@/components/neo";
import type { McpDraft } from "./McpDraft";

export function McpEditor({ initial, creating, busy, formId, onSave }: {
	initial: McpDraft;
	creating: boolean;
	busy: boolean;
	formId: string;
	onSave: (draft: McpDraft) => Promise<void>;
}) {
	const [draft, setDraft] = useState(initial);
	const set = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
	const pairsKey = draft.transport === "stdio" ? "env" : "headers";
	const pairs = draft[pairsKey];
	return <form id={formId} onSubmit={event => { event.preventDefault(); if (!busy) void onSave(draft); }}>
		<fieldset disabled={busy} className="neo-settings-mcp-fields neo-settings-stack">
			<SectionLabel>{creating ? "New server" : `Edit ${initial.name}`}</SectionLabel>
			<div className="neo-settings-mcp-grid">
				{creating && <>
					<Field label="Name"><NeoInput className="neo-input" required value={draft.name} onChange={event => set("name", event.target.value)} placeholder="my-server" /></Field>
					<div className="neo-settings-field"><span>Scope</span><Segmented label="MCP server scope" value={draft.scope} onChange={value => set("scope", value)} disabled={busy} options={[{ value: "user", label: "User" }, { value: "project", label: "Project" }]} /></div>
				</>}
				<div className="neo-settings-field"><span>Transport</span><Segmented label="MCP server transport" value={draft.transport} onChange={value => set("transport", value)} disabled={busy} options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "http" }, { value: "sse", label: "sse" }]} /></div>
				<Field label="Timeout in milliseconds"><NeoInput className="neo-input" type="number" min="0" step="1" placeholder="NeoPi default" value={draft.timeout} onChange={event => set("timeout", event.target.value)} /></Field>
			</div>
			{draft.transport === "stdio" ? <>
				<Field label="Command"><NeoInput className="neo-input" required value={draft.command} onChange={event => set("command", event.target.value)} placeholder="bunx" /></Field>
				<Field label="Working directory"><NeoInput className="neo-input" value={draft.cwd} onChange={event => set("cwd", event.target.value)} placeholder="Optional" /></Field>
				<div className="neo-settings-stack">
					<SectionLabel>Arguments</SectionLabel>
					{draft.args.map((arg, index) => <div key={index} className="neo-settings-mcp-entry">
						<NeoInput aria-label={`Argument ${index + 1}`} className="neo-input" readOnly={arg.keepIndex !== undefined} value={arg.flag !== undefined ? `${arg.flag} ••••••` : arg.text} onChange={event => set("args", draft.args.map((item, i) => i === index ? { text: event.target.value } : item))} />
						{arg.keepIndex !== undefined && <NeoBadge title="Kept at its stored index. Remove this row to replace the credential and its flag together.">Stored</NeoBadge>}
						<NeoButton size="sm" variant="ghost" aria-label={`Remove argument ${index + 1}`} onClick={() => set("args", draft.args.filter((_, i) => i !== index))}>Remove</NeoButton>
					</div>)}
					<div><NeoButton size="sm" variant="ghost" onClick={() => set("args", [...draft.args, { text: "" }])}>Add argument</NeoButton></div>
				</div>
			</> : <Field label="URL">
				<NeoInput className="neo-input" type="text" required={!draft.urlKept} autoComplete="off" value={draft.url} placeholder={draft.urlKept ? "Stored URL retained. Type to replace." : "https://example.com/mcp"} onChange={event => setDraft(current => ({ ...current, url: event.target.value, urlKept: false }))} />
				{draft.urlKept && <span className="neo-settings-description">The server hides the entire URL because any part can contain a credential. Leaving this unchanged keeps the stored URL.</span>}
			</Field>}
			<div className="neo-settings-stack">
				<SectionLabel>{pairsKey === "env" ? "Environment variables" : "Headers"}</SectionLabel>
				{pairs.map((pair, index) => <div className="neo-settings-mcp-pair" key={index}>
					<NeoInput className="neo-input" aria-label={`${pairsKey === "env" ? "Variable" : "Header"} name ${index + 1}`} placeholder="Name" value={pair.key} onChange={event => set(pairsKey, pairs.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
					<NeoInput className="neo-input" aria-label={`Value for ${pair.key || `entry ${index + 1}`}`} autoComplete="off" type="password" placeholder={pair.stored ? "Stored value retained" : "Value"} value={pair.stored ? "" : pair.value} onChange={event => set(pairsKey, pairs.map((item, i) => i === index ? { ...item, value: event.target.value, stored: false } : item))} />
					<NeoButton size="sm" variant="ghost" aria-label={`Remove ${pair.key || `entry ${index + 1}`}`} onClick={() => set(pairsKey, pairs.filter((_, i) => i !== index))}>Remove</NeoButton>
				</div>)}
				<div><NeoButton size="sm" variant="ghost" onClick={() => set(pairsKey, [...pairs, { key: "", value: "", stored: false }])}>Add {pairsKey === "env" ? "variable" : "header"}</NeoButton></div>
				<p className="neo-settings-description">Stored values never leave the server. Unchanged fields keep them. Remove a row to delete it.</p>
			</div>
			<p className="neo-settings-description">Saving writes the config file and reconciles each live chat. The result reports how far the change reached.</p>
		</fieldset>
	</form>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return <label className="neo-settings-field"><span>{label}</span>{children}</label>;
}
