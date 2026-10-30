import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { McpServerMutationResponse, McpServerRow, McpServersResponse } from "@npi-deck/protocol";
import { Card, Drawer, Empty, KeyValue, LabelCell, NeoBadge, NeoButton, Switch, Table, type Column } from "@/components/neo";
import { McpServersApiError } from "@/lib/mcp-servers-api";
import { settings } from "../../client/settings";
import { IntegrationNotice, integrationError, useIntegrationNotice } from "./IntegrationNotice";
import { MCP_DISABLED_REASON, type McpDraft, mcpDraftOf, mcpTarget, mcpWriteBody, newMcpDraft } from "./McpDraft";
import { McpEditor } from "./McpEditor";

const rowKey = (row: McpServerRow) => `${row.sourcePath}:${row.name}`;

export function McpIntegrationCard() {
	const [data, setData] = useState<McpServersResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [open, setOpen] = useState(false);
	const [editor, setEditor] = useState<{ draft: McpDraft; row: McpServerRow | null } | null>(null);
	const [details, setDetails] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const formId = useId();
	const { notice, report } = useIntegrationNotice();
	const load = useCallback(async () => { setData(await settings.mcp.list()); }, []);
	const refresh = useCallback(async () => {
		setLoading(true);
		try { await load(); }
		catch (error) { report(integrationError(error), true); }
		finally { setLoading(false); }
	}, [load, report]);
	useEffect(() => { void refresh(); }, [refresh]);

	async function run(action: () => Promise<McpServerMutationResponse>) {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const result = await action();
			setEditor(null);
			setRemoving(null);
			try { await load(); report(result.applyNote); }
			catch (error) { report(`${result.applyNote} Could not refresh the list: ${integrationError(error)}`, true); }
		} catch (error) {
			if (error instanceof McpServersApiError && error.status === 409) {
				setEditor(null);
				setRemoving(null);
				try { await load(); }
				catch (reloadError) { report(`${integrationError(error)} Could not refresh the list: ${integrationError(reloadError)}`, true); return; }
			}
			report(integrationError(error), true);
		} finally { busyRef.current = false; setBusy(false); }
	}

	async function save(draft: McpDraft) {
		const row = editor?.row;
		await run(() => row
			? settings.mcp.update(row.name, { ...mcpWriteBody(draft), revision: row.revision ?? "" })
			: settings.mcp.create({ name: draft.name.trim(), ...mcpWriteBody(draft) }));
	}

	function close() {
		setOpen(false);
		setEditor(null);
		setRemoving(null);
	}

	const columns: Column<McpServerRow>[] = [
		{ key: "name", header: "Name", sort: row => row.name, render: row => <div className="neo-settings-mcp-name"><LabelCell primary={row.name} secondary={row.providerName || row.provider} /><NeoButton size="sm" variant="ghost" aria-label={`Details for ${row.name}`} onClick={() => setDetails(current => current === rowKey(row) ? null : rowKey(row))}>Details</NeoButton></div> },
		{ key: "transport", header: "Transport", sort: row => row.transport, render: row => <NeoBadge mono>{row.transport}</NeoBadge> },
		{ key: "scope", header: "Scope", sort: row => row.level, render: row => row.level },
		{ key: "enabled", header: "Enabled", render: row => <Switch checked={row.state === "enabled"} disabled={busy || loading || row.state === "shadowed"} label={`Enable ${row.name} from ${row.providerName || row.provider}`} onChange={enabled => void run(() => settings.mcp.setEnabled(row.name, { ...mcpTarget(row), enabled }))} /> },
		{ key: "actions", header: "Actions", wrap: true, render: row => row.editable ? <div className="neo-settings-actions">
			<NeoButton size="sm" variant="ghost" disabled={busy || loading} onClick={() => { setEditor({ draft: mcpDraftOf(row), row }); setRemoving(null); }}>Edit</NeoButton>
			{removing === rowKey(row) ? <>
				<NeoButton size="sm" variant="danger" disabled={busy || loading} onClick={() => void run(() => settings.mcp.remove(row.name, { ...mcpTarget(row), revision: row.revision ?? "" }))}>Confirm removal</NeoButton>
				<NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>Cancel</NeoButton>
			</> : <NeoButton size="sm" variant="ghost" disabled={busy || loading} onClick={() => setRemoving(rowKey(row))}>Remove</NeoButton>}
		</div> : <NeoBadge title="Edit this server in its source file. NeoPi does not rewrite another tool's config.">Read-only file</NeoBadge> },
	];

	return <>
		<Card title="MCP servers" description="Tools available to NeoPi chats.">
			<div className="neo-settings-stack">
				{!open && <IntegrationNotice notice={notice} />}
				<div className="neo-settings-integrations-count">{data ? `${data.servers.length} server${data.servers.length === 1 ? "" : "s"}` : loading ? "Loading servers" : "Servers unavailable"}</div>
				<p className="neo-settings-description">User, project and discovered configurations.</p>
				<div className="neo-settings-actions"><NeoButton size="sm" onClick={() => { setOpen(true); if (!data) void refresh(); }}>Manage</NeoButton></div>
			</div>
		</Card>
		<Drawer open={open} onClose={close} width={800} title={editor ? editor.row ? `Edit ${editor.row.name}` : "Add MCP server" : "MCP servers"} subtitle="Live configuration. Stored credentials stay on the server."
			actions={!editor && <div className="neo-settings-actions"><NeoButton size="sm" disabled={busy || loading} onClick={() => void refresh()}>{loading ? "Refreshing..." : "Refresh"}</NeoButton><NeoButton size="sm" variant="primary" disabled={busy || loading || !data} onClick={() => { setEditor({ draft: newMcpDraft(), row: null }); setRemoving(null); }}>Add server</NeoButton></div>}
			footer={editor ? <div className="neo-settings-actions"><NeoButton type="submit" form={formId} variant="primary" disabled={busy}>{busy ? "Saving..." : "Save server"}</NeoButton><NeoButton disabled={busy} variant="ghost" onClick={() => setEditor(null)}>Cancel</NeoButton></div> : undefined}>
			<div className="neo-settings-stack">
				<IntegrationNotice notice={notice} />
				{editor ? <McpEditor key={editor.row ? `${rowKey(editor.row)}:${editor.row.revision}` : "new"} initial={editor.draft} creating={!editor.row} busy={busy} formId={formId} onSave={save} /> : <>
					{data && <>
						<KeyValue items={[{ key: "Workspace", value: data.cwd }, { key: "User config", value: data.userConfigPath }, { key: "Project config", value: data.projectConfigPath }]} />
						{!data.projectConfigEnabled && <p className="neo-settings-description">Project config is off in NeoPi. New chats ignore project servers until mcp.enableProjectConfig is enabled.</p>}
						{data.warnings.map((warning, index) => <p key={index} className="neo-settings-mcp-warning">{warning}</p>)}
						<Table columns={columns} rows={data.servers} rowKey={rowKey} initialSort={{ key: "name", dir: "asc" }} expanded={row => details === rowKey(row) ? <McpDetails row={row} /> : null} empty={<Empty title="No MCP servers configured" hint="Add a server to give NeoPi chats access to its tools." />} />
					</>}
					{!data && <Empty title={loading ? "Loading MCP servers" : "MCP servers unavailable"} hint="Refresh to load the current configuration." />}
				</>}
			</div>
		</Drawer>
	</>;
}

function McpDetails({ row }: { row: McpServerRow }) {
	return <div className="neo-settings-mcp-details neo-settings-stack">
		<KeyValue items={[
			{ key: "Source", value: row.sourcePath },
			{ key: "State", value: row.state },
			{ key: row.transport === "stdio" ? "Command" : "URL", value: row.transport === "stdio" ? [row.command, ...(row.args ?? []).map(arg => arg.display)].filter(Boolean).join(" ") : row.url ?? "Not set" },
			...(row.cwd ? [{ key: "Working directory", value: row.cwd }] : []),
			...(row.timeout !== undefined ? [{ key: "Timeout", value: `${row.timeout} ms` }] : []),
		]} />
		{row.disabledReason && <p className="neo-settings-description">{MCP_DISABLED_REASON[row.disabledReason]}</p>}
		{row.forceEnabled && <NeoBadge>Forced on by the user allowlist</NeoBadge>}
		{row.env.length > 0 && <p className="neo-settings-description">Environment: {row.env.map(entry => `${entry.key} ${entry.set ? "stored" : "empty"}`).join(", ")}</p>}
		{row.headers.length > 0 && <p className="neo-settings-description">Headers: {row.headers.map(entry => `${entry.key} ${entry.set ? "stored" : "empty"}`).join(", ")}</p>}
		{!row.editable && <p className="neo-settings-description">Edit this server where it lives. The deck never rewrites another tool's config.</p>}
	</div>;
}
