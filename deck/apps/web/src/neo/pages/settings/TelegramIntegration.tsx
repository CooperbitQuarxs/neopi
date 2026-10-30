import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeLogLine, SessionSummary, TelegramConversation, TelegramPairing, TelegramSetup } from "@npi-deck/protocol";
import { Card, Check, Dot, Drawer, Empty, NeoButton, NeoInput, NeoSelect, Notice, Segmented, Switch } from "@/components/neo";
import { telegram } from "../../client/telegram";
import { settings } from "../../client/settings";
import { IntegrationNotice, integrationError, useIntegrationNotice } from "./IntegrationNotice";
import "./TelegramIntegration.css";

export function TelegramIntegration() {
	const [data, setData] = useState<TelegramSetup>();
	const [token, setToken] = useState("");
	const [users, setUsers] = useState("");
	const [groups, setGroups] = useState("");
	const [mention, setMention] = useState(true);
	const [pairing, setPairing] = useState<TelegramPairing>();
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionsError, setSessionsError] = useState<string>();
	const [busy, setBusy] = useState<string>();
	const busyRef = useRef(false);
	const initialized = useRef(false);
	const [logsOpen, setLogsOpen] = useState(false);
	const [now, setNow] = useState(Date.now());
	const { notice, report } = useIntegrationNotice();
	const refresh = useCallback(async () => {
		const next = await telegram.get();
		setData(next);
		if (!initialized.current) {
			setUsers(next.allowedUsers); setGroups(next.allowedGroups); setMention(next.requireMention); initialized.current = true;
		}
	}, []);
	const loadSessions = useCallback(async () => {
		try { setSessions((await telegram.sessions()).sessions); setSessionsError(undefined); }
		catch (error) { setSessionsError(integrationError(error)); }
	}, []);
	useEffect(() => {
		void refresh().catch(error => report(integrationError(error), true));
		void loadSessions();
		const timer = setInterval(() => {
			setNow(Date.now());
			if (!document.hidden && !busyRef.current) void refresh().catch(error => report(integrationError(error), true));
		}, 5000);
		return () => clearInterval(timer);
	}, [refresh, loadSessions, report]);
	useEffect(() => {
		if (pairing && data?.pairedUsers.some(user => Date.parse(user.pairedAt) >= Date.parse(pairing.expiresAt) - 10 * 60_000)) {
			setPairing(undefined);
			report("Account paired. Choose its chat destination below.");
		}
	}, [pairing, data?.pairedUsers, report]);
	async function run(name: string, action: () => Promise<unknown>, success?: string) {
		if (busyRef.current) return;
		busyRef.current = true; setBusy(name);
		try { await action(); await refresh(); if (success) report(success); }
		catch (error) { report(integrationError(error), true); }
		finally { busyRef.current = false; setBusy(undefined); }
	}
	const active = data?.bridge.status === "running" || data?.bridge.status === "starting";
	const dirty = data && (token !== "" || users !== data.allowedUsers || groups !== data.allowedGroups || mention !== data.requireMention);
	const locked = (field: string) => !!data?.lockedFields.includes(field);
	const pollFresh = data?.runtime.polledAt && now - Date.parse(data.runtime.polledAt) < 75_000;
	const status = !data ? "Loading connection" : data.bridge.status === "running" ? data.runtime.error ? "Polling interrupted" : pollFresh ? "Receiving messages" : "Connecting to Telegram" : data.bridge.status;
	const save = () => run("save", async () => {
		await telegram.configure({ ...(token ? { botToken: token } : {}), ...(!locked("allowedUsers") ? { allowedUsers: users } : {}), ...(!locked("allowedGroups") ? { allowedGroups: groups } : {}), ...(!locked("requireMention") ? { requireMention: mention } : {}) });
		setToken("");
	}, active ? "Saved. Restart the bridge to apply connection and allowlist changes." : "Connection saved. Start the bridge when you are ready.");
	const updateConversation = (row: TelegramConversation, value: Parameters<typeof telegram.conversation>[1]) => run(row.id, () => telegram.conversation(row.id, value));
	return <Card title="Telegram" description="Capture a thought, continue a thread, or hear when an agent needs you." className="neo-telegram" actions={<div className="neo-telegram-status" role="status"><Dot tone={active && pollFresh && !data?.runtime.error ? "live" : data?.bridge.status === "crashed" || data?.runtime.error ? "bad" : undefined} />{status}</div>}>
		<IntegrationNotice notice={notice} />
		{data?.runtime.error && <div role="alert"><Notice tone="warn">{data.runtime.error}</Notice></div>}
		{data?.bridge.lastError && <div role="alert"><Notice tone="warn">{data.bridge.lastError}</Notice></div>}
		{data?.restartRequired && <Notice tone="warn">Saved connection changes are not active yet. Restart the bridge before pairing another account.</Notice>}
		<div className="neo-telegram-setup">
			<form className="neo-telegram-section" onSubmit={event => { event.preventDefault(); void save(); }}>
				<h3>Bot connection {data?.runtime.username && <span>@{data.runtime.username}</span>}</h3>
				<p>Create a separate bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>. Keep any existing bot receiver separate.</p>
				<label>Bot token<NeoInput type="password" autoComplete="new-password" value={token} disabled={locked("botToken") || !!busy} placeholder={data?.configured ? "Token saved. Enter a replacement to change it." : "Token from BotFather"} onChange={event => setToken(event.target.value)} /></label>
				{locked("botToken") && <p>Token is managed by the server's launching environment.</p>}
				<details className="neo-telegram-access"><summary>Manual allowlist and group access</summary>
					<label>Allowed user IDs<NeoInput value={users} disabled={locked("allowedUsers") || !!busy} onChange={event => setUsers(event.target.value)} placeholder="123456789, 987654321" /></label>
					<label>Allowed group IDs<NeoInput value={groups} disabled={locked("allowedGroups") || !!busy} onChange={event => setGroups(event.target.value)} placeholder="-1001234567890" /></label>
					<Check checked={mention} disabled={locked("requireMention") || !!busy} onChange={setMention}>Require a mention, command or reply in groups</Check>
					<p>A group needs an allowed group ID and an allowed or paired sender. Topic filters and wake patterns remain in Advanced settings.</p>
					{data?.lockedFields.some(field => field !== "botToken") && <p>Disabled fields are set by the server's launching environment.</p>}
				</details>
				<div className="neo-settings-actions"><NeoButton type="submit" variant="primary" disabled={!dirty || !!busy}>{busy === "save" ? "Saving..." : "Save connection"}</NeoButton><NeoButton disabled={!data?.configured || !!busy || !!dirty} onClick={() => void run("verify", async () => { const bot = await telegram.verify(); report(`Token verified for @${bot.username}. No message was sent.`); })}>Verify token</NeoButton></div>
				<div className="neo-settings-actions">
					<NeoButton disabled={!data?.configured || !!busy || !!dirty} onClick={() => void run(active ? "stop" : "start", () => active ? settings.bridges.stop("telegram") : settings.bridges.start("telegram"))}>{active ? "Stop bridge" : "Start bridge"}</NeoButton>
					{active && <NeoButton disabled={!!busy || !!dirty} onClick={() => void run("restart", () => settings.bridges.restart("telegram"))}>Restart bridge</NeoButton>}
					<NeoButton variant="ghost" onClick={() => setLogsOpen(true)}>View logs</NeoButton>
				</div>
				<p>Saving does not start the bot. Stopping it leaves NeoPi and your threads running.</p>
			</form>
			<div className="neo-telegram-section">
				<h3>Pair your account</h3>
				<p>Create a one-use invitation, then open it in Telegram and press Start. It grants access to this deck. Keep the link private.</p>
				<NeoButton disabled={!data?.configured || !active || !!busy || !!dirty || data.restartRequired} onClick={() => void run("pair", async () => { setPairing(await telegram.pair()); setNow(Date.now()); })}>Create pairing invitation</NeoButton>
				{!active && <p>Start the bridge before pairing. An empty allowlist accepts only valid invitations.</p>}
				{pairing && <div className="neo-telegram-invitation">
					{Date.parse(pairing.expiresAt) <= now ? <p>Invitation expired. Create another to pair.</p> : <>
						{pairing.url ? <a href={pairing.url} target="_blank" rel="noreferrer">Open invitation in Telegram</a> : <p>Send this command to your bot in a private chat.</p>}
						<code>/start pair_{pairing.code}</code>
						<p>Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}. Creating another invitation cancels this one.</p>
						<NeoButton size="sm" disabled={!!busy} onClick={() => void run("cancel-pair", async () => { await telegram.cancelPairing(); setPairing(undefined); })}>Cancel invitation</NeoButton>
					</>}
				</div>}
				<div className="neo-telegram-users">
					{data?.pairedUsers.map(user => <div key={user.id}><span>{user.label}<small>{user.id}</small></span><NeoButton size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("unpair", () => telegram.unpair(user.id), "Pairing removed. If the user is also manually allowlisted, remove that ID and restart the bridge.")}>Unpair</NeoButton></div>)}
					{data && !data.pairedUsers.length && <p>No accounts paired yet. Manually allowlisted users can already connect.</p>}
				</div>
			</div>
		</div>
		<div className="neo-telegram-routing">
			<div className="neo-telegram-routing-heading"><div><h3>Chat destinations</h3><p>Each private chat or group topic keeps its own thread and default action. Explicit /chat, /capture and /task commands override it.</p></div><NeoButton size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("refresh", loadSessions)}>Refresh threads</NeoButton></div>
			{sessionsError && <Notice tone="warn">Thread list unavailable: {sessionsError}. Existing bindings are unchanged.</Notice>}
			{data?.conversations.length ? <div className="neo-telegram-conversations">{data.conversations.map(row => <div className="neo-telegram-conversation" key={row.id}>
				<div><strong>{row.label}</strong><small>{row.id}</small>{row.lastError && <p role="alert">{row.lastError}</p>}{row.lastNotificationAt && <small>Last notification {new Date(row.lastNotificationAt).toLocaleString()}</small>}</div>
				<fieldset className="neo-telegram-mode" disabled={!!busy}><legend>Ordinary messages</legend><Segmented label={`Default action for ${row.label}`} value={row.mode} options={[{ value: "task", label: "Task" }, { value: "capture", label: "Capture" }, { value: "chat", label: "Chat" }]} onChange={mode => void updateConversation(row, { mode })} /></fieldset>
				<label>Agent's thread<NeoSelect aria-label={`Thread for ${row.label}`} value={row.sessionId ?? ""} disabled={!!busy || !!sessionsError} onChange={event => void updateConversation(row, { sessionId: event.target.value || null })}><option value="">New thread on next chat</option>{row.sessionId && !sessions.some(session => session.id === row.sessionId) && <option value={row.sessionId}>{row.sessionId} · unavailable</option>}{sessions.map(session => <option key={session.id} value={session.id}>{session.title || "Untitled"} · {session.id.slice(0, 8)}</option>)}</NeoSelect></label>
				<div className="neo-telegram-notify"><span>Needs you</span><Switch label={`Needs you notifications for ${row.label}`} checked={row.notify} disabled={!!busy || (!row.sessionId && !row.notify)} onChange={notify => void updateConversation(row, { notify })} /></div>
			</div>)}</div> : <Empty title="No Telegram conversations yet" hint="Pair an account or allowlist a sender, then send a message to your bot. Its chat appears here automatically." />}
			<p>Chat uses the agent in the selected NeoPi thread. Needs-you notifications report plan reviews and agent questions. They do not approve anything on your behalf.</p>
		</div>
		<TelegramLogs open={logsOpen} onClose={() => setLogsOpen(false)} />
	</Card>;
}

function TelegramLogs({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [lines, setLines] = useState<BridgeLogLine[]>([]);
	const [busy, setBusy] = useState(false);
	const { notice, report } = useIntegrationNotice();
	const refresh = useCallback(async () => {
		setBusy(true);
		try { setLines((await settings.bridges.logs("telegram")).lines); }
		catch (error) { report(integrationError(error), true); }
		finally { setBusy(false); }
	}, [report]);
	useEffect(() => { if (open) void refresh(); }, [open, refresh]);
	return <Drawer open={open} onClose={onClose} title="Telegram logs" subtitle="Output from this deck's bridge process." actions={<NeoButton size="sm" disabled={busy} onClick={() => void refresh()}>Refresh</NeoButton>}><IntegrationNotice notice={notice} />{lines.length ? <pre className="neo-telegram-logs">{lines.map(line => `${line.timestamp} ${line.stream}\n${line.text}`).join("\n")}</pre> : <Empty title={busy ? "Loading logs" : "No log lines yet"} hint="Start the bridge to see its output." />}</Drawer>;
}
