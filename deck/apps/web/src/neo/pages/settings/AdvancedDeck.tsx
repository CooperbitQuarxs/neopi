import { useCallback, useEffect, useState } from "react";
import { Copy, RotateCcw } from "lucide-react";
import type { BackendStatusResponse, ListEnvSettingsResponse } from "@npi-deck/protocol";
import { KeyValue, NeoBadge, NeoButton, SectionLabel } from "@/components/neo";
import { useStore } from "@/lib/store";
import { formatUptime } from "@/lib/time";
import { settings, type DeckHealth } from "../../client/settings";
import { AdvancedNotice, advancedError, useAdvancedNotice } from "./AdvancedNotice";

export function AdvancedDeck() {
	const heartbeat = useStore(store => store.heartbeat);
	const wsStatus = useStore(store => store.wsStatus);
	const generation = useStore(store => store.workerGeneration);
	const defaultCwd = useStore(store => store.defaultCwd);
	const [backend, setBackend] = useState<BackendStatusResponse | null>(null);
	const [env, setEnv] = useState<ListEnvSettingsResponse | null>(null);
	const [health, setHealth] = useState<DeckHealth | null>(null);
	const [state, setState] = useState<Record<string, unknown> | null>(null);
	const [stateStatus, setStateStatus] = useState("Not loaded");
	const [busy, setBusy] = useState(false);
	const [now, setNow] = useState(Date.now);
	const { message, notify } = useAdvancedNotice();
	const refresh = useCallback(async () => {
		setBusy(true);
		const [backendResult, envResult, healthResult, stateResult] = await Promise.allSettled([settings.engine.backendStatus(), settings.engine.listEnv(), settings.health(), settings.state()]);
		const errors: string[] = [];
		if (backendResult.status === "fulfilled") setBackend(backendResult.value); else errors.push(`Backend: ${advancedError(backendResult.reason)}`);
		if (envResult.status === "fulfilled") setEnv(envResult.value); else errors.push(`Environment: ${advancedError(envResult.reason)}`);
		if (healthResult.status === "fulfilled") setHealth(healthResult.value); else errors.push(`Health: ${advancedError(healthResult.reason)}`);
		if (stateResult.status === "fulfilled") { setState(stateResult.value); setStateStatus("Available"); }
		else { setState(null); setStateStatus("Unavailable from this server"); errors.push(`/api/state: ${advancedError(stateResult.reason)}`); }
		if (errors.length) notify(errors.join("\n"), "warn");
		setBusy(false);
	}, [notify]);
	useEffect(() => { void refresh(); }, [refresh, generation]);
	useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
	const database = env?.entries.find(entry => entry.key === "NPI_DECK_DB_PATH");
	const startedAt = heartbeat?.serverStartedAt ?? health?.serverStartedAt;
	const age = heartbeat ? Math.max(0, now - heartbeat.lastReceivedAtMs) : null;
	const facts: Array<{ key: string; value: string }> = [
		{ key: "Deck version", value: heartbeat?.version ?? health?.version ?? "Not available" },
		{ key: "Deck build", value: heartbeat?.buildSha ?? health?.buildSha ?? "Unknown" },
		{ key: "Server PID", value: String(heartbeat?.pid ?? health?.pid ?? "Not available") },
		{ key: "Server started", value: startedAt ? new Date(startedAt).toLocaleString() : "Not available" },
		{ key: "Server uptime", value: startedAt ? formatUptime(startedAt, now) : "Not available" },
		{ key: "Browser link", value: wsStatus },
		{ key: "Health endpoint", value: health ? health.ok ? "Healthy" : "Unhealthy" : "Not available" },
		{ key: "Worker generation", value: generation ?? backend?.workerGeneration ?? "Not available" },
		{ key: "NeoPi backend", value: backend?.running?.path ?? (backend ? "None loaded" : "Not available") },
		{ key: "NeoPi version", value: backend?.running?.version ?? "Unknown" },
		{ key: "NeoPi commit", value: backend?.running?.commit ?? "Unknown" },
		{ key: "Backend selection", value: backend?.pinned ? "Pinned by launch environment" : backend?.desired ?? "Automatic" },
		{ key: "Default workspace", value: health?.defaultCwd ?? (defaultCwd || "Not available") },
		{ key: "Extra workspaces", value: health ? health.extraWorkspaces.join("\n") || "None" : "Not available" },
		{ key: "Data directory", value: env?.dataDir ?? "Not available" },
		{ key: "Managed environment", value: env?.envFilePath ?? "Not available" },
		{ key: "Database", value: database?.isSet ? database.masked : env ? `${env.dataDir}/deck.db` : "Not available" },
		{ key: "/api/state", value: stateStatus },
	];
	const deckEnv = (env?.entries ?? []).filter(entry => entry.key.startsWith("NPI_DECK_") && !entry.sensitive).map(entry => ({ key: entry.key, value: `${entry.masked} [${entry.source}]` }));
	async function copy() {
		try {
			const text = [...facts, ...deckEnv].map(item => `${item.key}: ${item.value}`).join("\n") + (state ? `\n\n/api/state\n${JSON.stringify(state, null, 2)}` : "");
			await navigator.clipboard.writeText(text); notify("Diagnostics copied.");
		} catch (error) { notify(`Clipboard refused the copy: ${advancedError(error)}`, "warn"); }
	}
	return <div className="neo-settings-stack">
		<AdvancedNotice message={message} />
		<div className="neo-settings-advanced-heading"><p className="neo-settings-description">Read-only runtime facts from the deck server, managed environment and browser connection. No configuration is written here.</p><div className="neo-settings-actions"><NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}><RotateCcw size={13} />Reload</NeoButton><NeoButton size="sm" disabled={busy} onClick={() => void copy()}><Copy size={13} />Copy diagnostics</NeoButton></div></div>
		<div><SectionLabel actions={<NeoBadge tone={age === null || age >= 30000 ? "warn" : "ok"}>{age === null ? "No heartbeat" : `Heartbeat ${Math.round(age / 1000)}s ago`}</NeoBadge>}>Runtime</SectionLabel><KeyValue items={facts} /></div>
		{backend?.reason && <p className="neo-settings-description">{backend.reason}</p>}
		{deckEnv.length > 0 && <div><SectionLabel>Deck environment</SectionLabel><KeyValue items={deckEnv} /></div>}
		{state && <div><SectionLabel>Server state</SectionLabel><pre className="neo-settings-advanced-json">{JSON.stringify(state, null, 2)}</pre></div>}
	</div>;
}
