/**
 * Threads: conversations whose members are equals. Main is the member a
 * thread starts with, rendered and addressed exactly like the others; an
 * agent another member started carries that as a relationship ("started by
 * Main"), not as a smaller kind of agent. The composer addresses one member
 * or everyone. See ~/.cache/npi-canary/neodeck-pool/philosophy.md §1.
 */
import "./threads.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, MessagesSquare, MoreHorizontal, Plus } from "lucide-react";
import { Dot, Empty, ErrorState, NeoButton, NeoMenu, NeoPopover, NeoSelect, Notice, PageHeader, SearchInput, Segmented, formatShortRelative } from "@/components/neo";
import { ExtUiDialog } from "@/components/chat/ExtUiDialog";
import { api } from "@/lib/api";
import { initSession } from "@/lib/reducer";
import { useStore } from "@/lib/store";
import { tasksApi } from "@/lib/tasks-api";
import type { SessionUi } from "@/lib/types";
import { formatCost, formatTokens } from "@/lib/utils";
import { threadAgents } from "../client/agents";
import { agentCatalog, hueFor, type AgentTemplate } from "../client/agentDefinitions";
import { shortPick } from "../client/models";
import { threads, useThreadsRevision, type ThreadAgent, type ThreadMessage, type ThreadSummary, type ThreadTranscript } from "../client/threads";
import { agentColor, AgentSwatch } from "../components/AgentSwatch";
import { ALL_TARGETS, Composer } from "../components/Composer";
import { PreviewChip } from "../components/PreviewChip";
import { NAV_ITEMS } from "../nav";
import { NewThread, type Location, type NewThreadInput } from "./threads/NewThread";
import { Transcript } from "./threads/Transcript";

const GROUPS = [{ state: "needs-you", label: "Needs you" }, { state: "working", label: "Working" }, { state: "settled", label: "Settled" }] as const;
const EMPTY_CHILDREN: ThreadTranscript = { messages: [], toolCalls: {} };

export function ThreadsPage() {
	const nav = NAV_ITEMS.find((item) => item.to === "/threads")!;
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const id = params.get("thread");
	const creating = params.get("new") === "1";
	const sessions = useStore((s) => s.sessions);
	const sessionsById = useStore((s) => s.sessionsById);
	const nodes = useStore((s) => s.subagentsBySession);
	const workspaces = useStore((s) => s.workspaces);
	const defaultCwd = useStore((s) => s.defaultCwd);
	const revision = useThreadsRevision();
	const [rows, setRows] = useState<ThreadSummary[]>(() => threads.previewList());
	const [listError, setListError] = useState<string>();
	const [search, setSearch] = useState("");
	const [project, setProject] = useState("");
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [targets, setTargets] = useState<Record<string, string>>({});
	const [mode, setMode] = useState<"prose" | "everything">("prose");
	const [depth, setDepth] = useState<"members" | "started">("members");
	const [children, setChildren] = useState<ThreadTranscript>(EMPTY_CHILDREN);
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState("");
	const [adding, setAdding] = useState(false);
	const [templates, setTemplates] = useState<AgentTemplate[]>([]);
	const addRef = useRef<HTMLButtonElement>(null);

	const selected = creating ? undefined : rows.find((row) => row.id === id);
	const session = selected?.live && id ? sessionsById[id] : undefined;
	/** Everyone in the thread. Who started whom is shown on the member, not used to rank them. */
	const members = selected?.agents ?? [];
	const target = id ? targets[id] ?? "main" : "main";
	const targetAgent = members.find((a) => a.id === target) ?? members[0];
	const targeted = target === ALL_TARGETS ? members : members.filter((a) => a.id === target);
	const busy = targeted.some((a) => a.state === "working");

	const patch = useCallback((next: Record<string, string | null>) => setParams((previous) => {
		const p = new URLSearchParams(previous);
		for (const [k, v] of Object.entries(next)) if (v === null) p.delete(k); else p.set(k, v);
		return p;
	}), [setParams]);
	const select = useCallback((next: string | null) => { setEditing(false); setError(undefined); patch({ thread: next, new: null }); }, [patch]);
	const startNew = useCallback(() => { setError(undefined); patch({ new: "1" }); }, [patch]);
	const refresh = useCallback(async () => { try { setRows(await threads.list()); setListError(undefined); } catch (e) { setListError(String(e)); } }, []);

	useEffect(() => { let cancelled = false; void threads.list().then((next) => { if (!cancelled) { setRows(next); setListError(undefined); } }, (e: unknown) => { if (!cancelled) setListError(String(e)); }); return () => { cancelled = true; }; }, [sessions, sessionsById, nodes, revision]);
	useEffect(() => { if (adding) void agentCatalog.load().then((c) => setTemplates(c.templates), () => setTemplates([])); }, [adding]);

	// Transcripts of members another member started, merged in when asked for.
	useEffect(() => {
		setChildren(EMPTY_CHILDREN);
		if (depth !== "started" || !session) return;
		let cancelled = false;
		void Promise.all((nodes[session.sessionId] ?? []).filter((node) => node.sessionFile).map(async (node) => {
			const response = await api.getSubagentTranscript(session.sessionId, node.id);
			const ui = initSession({ sessionId: node.id, cwd: session.cwd, isStreaming: false, messages: response.messages, todoPhases: [] });
			return { messages: ui.messages.map((m) => ({ ...m, agentId: node.id })), toolCalls: ui.toolCalls };
		})).then(
			(parts) => { if (!cancelled) setChildren({ messages: parts.flatMap((part) => part.messages), toolCalls: Object.assign({}, ...parts.map((part) => part.toolCalls)) as ThreadTranscript["toolCalls"] }); },
			(e: unknown) => { if (!cancelled) setError(`Could not load the transcripts of agents started in this thread. ${String(e)}`); },
		);
		return () => { cancelled = true; };
	}, [depth, id, nodes]);

	const openRequest = useRef(0);
	useEffect(() => {
		if (!selected?.live || !id) return;
		const request = ++openRequest.current;
		if (sessionsById[id]) { useStore.getState().selectSession(id); return; }
		if (!selected.sessionPath) return;
		setLoading(true);
		void useStore.getState().openTranscript(selected.sessionPath).then(() => { if (request !== openRequest.current) return; const opened = useStore.getState().activeId; if (opened && opened !== id) select(opened); }, (e: unknown) => { if (request === openRequest.current) setError(`Could not open this thread. ${String(e)}`); }).finally(() => { if (request === openRequest.current) setLoading(false); });
		return () => { openRequest.current++; };
	}, [id, selected?.live, selected?.sessionPath]);

	const filterHandled = useRef(false);
	useEffect(() => { if (params.get("filter") !== "needs-you") { filterHandled.current = false; return; } if (!filterHandled.current && rows.length) { const first = rows.find((r) => r.state === "needs-you"); if (first) select(first.id); filterHandled.current = true; } }, [params, rows, select]);

	const cardHandled = useRef<string>();
	useEffect(() => {
		const card = params.get("card");
		if (!card || cardHandled.current === card || !defaultCwd) return;
		cardHandled.current = card;
		void (async () => {
			const existingId = localStorage.getItem(`neodeck.card-thread.${card}`);
			if (existingId && rows.some((row) => row.id === existingId)) { select(existingId); return; }
			try {
				setLoading(true);
				const result = await tasksApi.list();
				const task = result.tasks.find((item) => `T-${item.displayId}` === card || item.id === card);
				if (!task) throw new Error(`Card ${card} was not found. Open the card on the Board and try again.`);
				const next = await useStore.getState().createSession({ cwd: task.cwd || defaultCwd });
				await useStore.getState().renameSession(next, task.title);
				localStorage.setItem(`neodeck.card-thread.${card}`, next);
				await refresh();
				select(next);
			} catch (e) { setError(`Could not open the card's thread. ${String(e)}`); } finally { setLoading(false); }
		})();
	}, [params, defaultCwd, rows, refresh, select]);

	const projects = useMemo(() => [...new Set([...workspaces.map((w) => w.cwd), ...rows.flatMap((r) => r.project ? [r.project] : [])])], [rows, workspaces]);
	const projectLabel = useCallback((value?: string): string => workspaces.find((w) => w.cwd === value)?.label || value?.split("/").filter(Boolean).at(-1) || "No project", [workspaces]);
	const locations = useMemo<Location[]>(() => {
		const recent = new Map<string, string>();
		for (const r of [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) if (r.live && r.project && !recent.has(r.project)) recent.set(r.project, formatShortRelative(r.updatedAt));
		const out: Location[] = [];
		const seen = new Set<string>();
		const push = (cwd: string, label: string, note?: string) => { if (!cwd || seen.has(cwd)) return; seen.add(cwd); out.push({ cwd, label, note }); };
		if (defaultCwd) push(defaultCwd, projectLabel(defaultCwd), "default");
		for (const w of workspaces) push(w.cwd, w.label || projectLabel(w.cwd), recent.has(w.cwd) ? `used ${recent.get(w.cwd)}` : "workspace");
		for (const [cwd, when] of recent) push(cwd, projectLabel(cwd), `used ${when}`);
		return out;
	}, [rows, workspaces, defaultCwd, projectLabel]);
	const visible = rows.filter((row) => (!project || row.project === project) && row.title.toLowerCase().includes(search.toLowerCase()));

	const previewTranscript = id ? threads.transcript(id) : EMPTY_CHILDREN;
	const transcript = useMemo(() => {
		const base: ThreadMessage[] = session?.messages ?? previewTranscript.messages;
		const extras = selected?.live ? previewTranscript.messages : [];
		const merged = [...base, ...extras, ...(depth === "started" ? children.messages : [])];
		if (extras.length || (depth === "started" && children.messages.length)) merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
		return merged;
	}, [session?.messages, previewTranscript.messages, children.messages, depth, selected?.live]);
	const usage = transcript.reduce((sum, m) => m.role === "assistant" ? { cost: sum.cost + (m.usage?.cost ?? 0), tokens: sum.tokens + (m.usage?.totalTokens ?? 0) } : sum, { cost: 0, tokens: 0 });

	async function run(action: () => Promise<void>): Promise<void> { setError(undefined); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }

	async function start(input: NewThreadInput): Promise<void> {
		const store = useStore.getState();
		const next = await store.createSession({ cwd: input.cwd });
		for (const t of input.members) await threads.addAgent(next, { name: t.name, hue: hueFor(t.name), model: t.model ?? "@default", template: t.id, restrictions: [] });
		await refresh();
		select(next);
		if (input.message) { store.selectSession(next); store.sendPrompt(input.message, undefined, next); }
	}
	async function rename(): Promise<void> { if (!id || !title.trim()) return; await run(async () => { await threads.rename(id, title.trim()); setEditing(false); await refresh(); }); }
	function startRename(): void { setTitle(selected?.title ?? ""); setEditing(true); }

	/**
	 * Live: Main gets a new turn; a member Main started is steered through its
	 * native instance. Members added in the deck are preview until NeoPi can
	 * host several equal agents in one conversation.
	 */
	async function send(text: string): Promise<void> {
		if (!selected || !id) return;
		await run(async () => {
			const ids = targeted.map((a) => a.id);
			if (!selected.live) { threads.send(id, ids, text); return; }
			const liveNodes = new Set((nodes[id] ?? []).map((n) => n.id));
			if (ids.includes("main")) { const next = await useStore.getState().resumeSession(id); useStore.getState().selectSession(next); useStore.getState().sendPrompt(text, undefined, next); if (next !== id) select(next); }
			await Promise.all(ids.filter((a) => liveNodes.has(a)).map((a) => threadAgents.send(id, a, text)));
			const previewIds = ids.filter((a) => a !== "main" && !liveNodes.has(a));
			if (previewIds.length) threads.send(id, previewIds, text);
		});
	}
	function stop(): void {
		if (!selected) return;
		if (selected.live && targeted.some((a) => a.id === "main")) { useStore.getState().selectSession(selected.id); useStore.getState().abort(); }
		threads.stop(selected.id, targeted.map((a) => a.id));
	}
	async function addMember(t: AgentTemplate): Promise<void> {
		if (!selected) return;
		setAdding(false);
		await run(async () => {
			const added = await threads.addAgent(selected.id, { name: uniqueName(t.name, members), hue: hueFor(t.name), model: t.model ?? "@default", template: t.id, restrictions: [] });
			setTargets((previous) => ({ ...previous, [selected.id]: added.id }));
		});
	}

	return (
		<div className="neo-fill neo-threads">
			<PageHeader title={nav.label} description="Conversations with one agent or several. Everyone in a thread is an equal member; address one or all." badge={<PreviewChip domains={["threadAgents"]} what="Members added in the deck and messages to everyone" />} actions={<NeoButton variant="primary" onClick={startNew}><Plus size={14} />New thread</NeoButton>} />
			<div className="neo-split neo-fill-body" style={{ "--split-w": "300px" } as CSSProperties}>
				<aside className="neo-split-list">
					<div className="neo-split-list-head">
						<SearchInput pageSearch value={search} onChange={setSearch} placeholder="Search threads" aria-label="Search threads" size="sm" />
						<NeoSelect value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter threads by project" size="sm"><option value="">All projects</option>{projects.map((value) => <option key={value} value={value}>{projectLabel(value)}</option>)}</NeoSelect>
					</div>
					<div className="neo-split-rows" onKeyDown={(e) => { if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key) || !(e.target instanceof HTMLButtonElement)) return; const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(".neo-row")); const i = buttons.indexOf(e.target); const next = buttons[i + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)]; if (next) { e.preventDefault(); next.focus(); next.click(); } }}>
						{listError ? <div className="neo-threads-list-notice" title={listError}><Notice tone="warn">Live sessions unavailable. Preview threads still work.</Notice></div> : null}
						{GROUPS.map((group) => {
							const items = visible.filter((row) => row.state === group.state).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
							return items.length ? (
								<section key={group.state} aria-label={group.label}>
									<div className="neo-split-group">{group.label}<span className="neo-num">{items.length}</span></div>
									{items.map((row) => (
										<button key={row.id} type="button" className="neo-row" data-active={row.id === id && !creating} data-settled={row.state === "settled"} data-state={row.state} title={`${row.title}\n${row.project ?? "No project"}\n${row.agents.map((a) => a.name).join(", ")}`} onClick={() => select(row.id)}>
											<span className="neo-row-lead"><Dot tone={row.state === "needs-you" ? "accent" : row.state === "working" ? "live" : undefined} pulse={row.state !== "settled"} /></span>
											<span className="neo-row-title">{row.title}</span>
											<span className="neo-row-when">{formatShortRelative(row.updatedAt)}</span>
											<span className="neo-row-sub">{projectLabel(row.project)}<span>·</span><span className="neo-threads-mini-agents">{row.agents.slice(0, 4).map((a) => <AgentSwatch key={a.id} hue={a.hue} size={8} />)}</span><span>{row.agents.map((a) => a.name).slice(0, 2).join(", ")}{row.agents.length > 2 ? ` +${row.agents.length - 2}` : ""}</span>{row.live ? null : <span className="neo-threads-live-label">preview</span>}</span>
										</button>
									))}
								</section>
							) : null;
						})}
						{visible.length === 0 ? <Empty title="No threads match" hint="Clear the search or choose another project." /> : null}
					</div>
				</aside>
				<section className="neo-split-detail">
					{error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
					{creating ? (
						<NewThread locations={locations} defaultCwd={defaultCwd} onStart={start} onCancel={() => patch({ new: null })} />
					) : selected ? (
						<>
							<header className="neo-threads-head">
								{editing ? (
									<form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="neo-threads-rename"><input className="neo-input" aria-label="Thread title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} /><NeoButton icon size="sm" type="submit" aria-label="Save thread title"><Check size={13} /></NeoButton></form>
								) : (
									<button type="button" className="neo-threads-title" title={`${selected.title} · click to rename`} onClick={startRename}>{selected.title}</button>
								)}
								<div className="neo-threads-head-meta"><span className="neo-mono" title={selected.project}>{projectLabel(selected.project)}</span><span className="neo-num">{formatCost(usage.cost)}</span><span className="neo-num">{formatTokens(usage.tokens)} tok</span></div>
								<NeoButton variant="ghost" size="sm" onClick={() => threads.settle(selected.id, selected.state !== "settled")}>{selected.state === "settled" ? "Reopen" : "Settle"}</NeoButton>
								<NeoMenu
									label="Thread actions"
									trigger={<NeoButton variant="ghost" size="sm" icon aria-label="Thread actions"><MoreHorizontal size={16} /></NeoButton>}
									items={[
										{ label: "Rename", onSelect: startRename },
										...(selected.live ? [{ label: "Open in legacy chat", onSelect: () => navigate("/legacy/chat") }] : []),
										{ label: "Dispose", danger: true, onSelect: () => void run(async () => { await threads.dispose(selected.id); select(null); await refresh(); }) },
									]}
								/>
							</header>
							<div className="neo-threads-members" aria-label="Members">
								<span className="neo-threads-members-label">Members</span>
								<div className="neo-threads-member-list">
									{members.map((agent) => (
										<MemberChip key={agent.id} agent={agent} members={members} on={target === agent.id || target === ALL_TARGETS} onClick={() => setTargets((previous) => ({ ...previous, [selected.id]: agent.id }))} />
									))}
									<NeoButton ref={addRef} variant="ghost" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}><Plus size={12} />Add</NeoButton>
									<NeoPopover open={adding} onClose={() => setAdding(false)} anchorRef={addRef} align="start" width={320} className="neo-threads-add">
										<p className="neo-threads-add-how">Start an instance of a template in this thread.{agentCatalog.spawnPreview ? " Preview: NeoPi can't host several equal agents in one conversation yet." : ""}</p>
										{templates.length === 0 ? <p className="neo-dim neo-threads-add-how">No templates. Write one on the Agents page.</p> : null}
										{templates.map((t) => (
											<button key={t.id} type="button" className="neo-threads-add-row" onClick={() => void addMember(t)} style={{ "--agent": agentColor(hueFor(t.name)) } as CSSProperties}>
												<i /><span><strong>{t.name}</strong>{t.description ? <small>{t.description}</small> : null}</span><span className="neo-mono">{t.model ? shortPick(t.model) : "inherits"}</span>
											</button>
										))}
									</NeoPopover>
								</div>
								<div className="neo-threads-view-controls">
									<Segmented label="Transcript view" value={mode} onChange={setMode} options={[{ value: "prose", label: "Prose" }, { value: "everything", label: "Everything" }]} />
									<Segmented label="Whose messages" value={depth} onChange={setDepth} options={[{ value: "members", label: "Thread" }, { value: "started", label: "+ started agents" }]} />
								</div>
							</div>
							{loading ? <p className="neo-thread-aside">Opening transcript…</p> : <Transcript key={`t:${selected.id}`} messages={transcript} agents={members} toolCalls={{ ...(session?.toolCalls ?? previewTranscript.toolCalls), ...children.toolCalls }} everything={mode === "everything"} session={session} />}
							{session?.lastError ? <p className="neo-threads-error neo-threads-session-error" role="alert">{session.lastError}</p> : null}
							<Composer
								key={`c:${selected.id}`}
								targets={members.map((a) => ({ id: a.id, name: a.name, hue: a.hue, detail: shortPick(a.model) }))}
								targetId={target}
								onTargetChange={(next) => setTargets((previous) => ({ ...previous, [selected.id]: next }))}
								model={targetAgent?.model ?? "@default"}
								onModelChange={(model) => void run(async () => { await Promise.all(targeted.map((agent) => threads.setModel(selected.id, agent.id, model))); })}
								onSend={send}
								busy={busy}
								onStop={stop}
								disabled={loading}
								draft={params.get("draft") ?? undefined}
								sessionId={session?.sessionId}
								cwd={selected.project}
								facts={<SessionFacts session={session} transcript={transcript} />}
							/>
						</>
					) : (
						<div className="neo-threads-empty"><Empty icon={MessagesSquare} title="Pick a thread, or start one" hint="A thread is one conversation with one or more agents. Open one on the left, or start a new one." action={<NeoButton variant="primary" onClick={startNew}><Plus size={14} />New thread</NeoButton>} /></div>
					)}
				</section>
			</div>
			{selected?.live ? <ExtUiDialog /> : null}
		</div>
	);
}

/** One member, rendered the same for Main and everyone else. */
function MemberChip({ agent, members, on, onClick }: { agent: ThreadAgent; members: readonly ThreadAgent[]; on: boolean; onClick: () => void }) {
	const starter = agent.spawnedBy ? members.find((m) => m.id === agent.spawnedBy)?.name ?? "another agent" : null;
	return (
		<button type="button" className="neo-threads-member" data-on={on || undefined} onClick={onClick} title={`${agent.name} · ${agent.model}${starter ? ` · started by ${starter}` : ""} · click to address`}>
			<AgentSwatch hue={agent.hue} name={agent.name} />
			<span className="neo-mono neo-threads-member-model">{shortPick(agent.model)}</span>
			{starter ? <span className="neo-threads-member-by">by {starter}</span> : null}
			<span className="neo-threads-member-state" data-state={agent.state}><Dot tone={agent.state === "needs-you" ? "accent" : agent.state === "working" ? "live" : undefined} pulse={agent.state === "working"} />{agent.state === "needs-you" ? "needs you" : agent.state}</span>
		</button>
	);
}

/** The session's numbers beside the composer. Unknown stays Unknown. */
function SessionFacts({ session, transcript }: { session?: SessionUi; transcript: readonly ThreadMessage[] }) {
	const last = [...transcript].reverse().find((m): m is Extract<ThreadMessage, { role: "assistant" }> => m.role === "assistant" && !m.isStreaming && Boolean(m.usage?.output) && Boolean(m.durationMs));
	const speed = last?.usage && last.durationMs ? last.usage.output / (last.durationMs / 1000) : null;
	const u = session?.usage;
	const cacheBase = u ? u.input + u.cacheRead : 0;
	const cache = u && cacheBase > 0 ? u.cacheRead / cacheBase : null;
	const context = session?.contextUsage?.percent ?? null;
	const cost = u ? u.cost : transcript.reduce((s, m) => s + (m.role === "assistant" ? m.usage?.cost ?? 0 : 0), 0);
	const model = session?.model ? `${session.model.provider}/${session.model.id}` : null;
	return (
		<>
			<span className="neo-composer-fact">model <b>{model ?? "Unknown"}</b></span>
			<span className="neo-composer-fact">effort <b>{session?.thinkingLevel ?? "Unknown"}</b></span>
			<span className="neo-composer-fact">speed <b>{speed === null ? "Unknown" : `${speed.toFixed(0)} tok/s`}</b></span>
			<span className="neo-composer-fact">cache <b>{cache === null ? "Unknown" : `${Math.round(cache * 100)}%`}</b></span>
			<span className="neo-composer-fact">context <span className="neo-composer-context" data-tone={context !== null && context > 80 ? "warn" : undefined}><i style={{ width: `${Math.min(100, context ?? 0)}%` }} /></span><b>{context === null ? "Unknown" : `${Math.round(context)}%`}</b></span>
			<span className="neo-composer-facts-spacer" />
			<span className="neo-composer-fact">thread <b>{formatCost(cost)}</b></span>
		</>
	);
}

function uniqueName(name: string, members: readonly ThreadAgent[]): string {
	let candidate = name;
	for (let i = 2; members.some((m) => m.name === candidate); i++) candidate = `${name} ${i}`;
	return candidate;
}
