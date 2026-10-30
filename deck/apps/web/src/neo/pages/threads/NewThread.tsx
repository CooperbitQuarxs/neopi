import { CornerDownLeft, Folder, FolderPlus } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, NeoButton } from "@/components/neo";
import { agentCatalog, hueFor, type AgentTemplate } from "../../client/agentDefinitions";
import { agentColor } from "../../components/AgentSwatch";

export interface Location { cwd: string; label: string; note?: string }
export interface NewThreadInput { cwd: string; members: AgentTemplate[]; message: string }

/**
 * Starting a thread: where it works, who is in it, and what to say first,
 * on one page. The location is a searchable list that also takes a typed
 * path; members are templates, Main first.
 */
export function NewThread({ locations, defaultCwd, onStart, onCancel }: { locations: readonly Location[]; defaultCwd: string; onStart: (input: NewThreadInput) => Promise<void>; onCancel: () => void }) {
	const [query, setQuery] = useState("");
	const [cwd, setCwd] = useState(defaultCwd);
	const [active, setActive] = useState(0);
	const [templates, setTemplates] = useState<AgentTemplate[]>([]);
	const [members, setMembers] = useState<string[]>([]);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => { searchRef.current?.focus(); }, []);
	useEffect(() => { void agentCatalog.load().then((c) => setTemplates(c.templates), () => setTemplates([])); }, []);
	useEffect(() => { if (!cwd && defaultCwd) setCwd(defaultCwd); }, [defaultCwd, cwd]);

	const typed = query.trim();
	const isPath = /^(\/|~)/.test(typed);
	const shown = useMemo(() => {
		const q = typed.toLowerCase();
		const hits = locations.filter((l) => !q || l.label.toLowerCase().includes(q) || l.cwd.toLowerCase().includes(q));
		return isPath && !locations.some((l) => l.cwd === typed) ? [{ cwd: typed, label: "Use this path", note: "typed" }, ...hits] : hits;
	}, [locations, typed, isPath]);
	useEffect(() => { setActive(0); }, [typed]);

	function onSearchKey(e: KeyboardEvent<HTMLInputElement>): void {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
		} else if (e.key === "Enter" && shown[active]) {
			e.preventDefault();
			setCwd(shown[active]!.cwd);
		} else if (e.key === "Escape" && query) {
			e.preventDefault();
			setQuery("");
		}
	}

	async function start(): Promise<void> {
		if (!cwd) { setError("Choose where the thread works."); return; }
		setBusy(true); setError(null);
		try { await onStart({ cwd, members: templates.filter((t) => members.includes(t.id)), message: message.trim() }); }
		catch (e) { setError(e instanceof Error ? e.message : String(e)); }
		finally { setBusy(false); }
	}

	return (
		<div className="neo-newthread">
			<header className="neo-newthread-head">
				<h2>New thread</h2>
				<p>Pick where the agents work, who is in the conversation, and the first thing to say. Every member is an equal; Main is just the first.</p>
			</header>
			{error ? <ErrorState error={error} /> : null}

			<section className="neo-newthread-section">
				<h3>Where</h3>
				<p className="neo-newthread-how">The working directory every member starts in. Search, or type a path starting with / or ~.</p>
				<input ref={searchRef} className="neo-input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder="Search projects or type a path" aria-label="Search locations" aria-controls="neo-newthread-locations" />
				<div id="neo-newthread-locations" className="neo-newthread-locations" role="listbox" aria-label="Locations">
					{shown.length === 0 ? <p className="neo-dim neo-newthread-none">No project matches. Type a full path to use it.</p> : null}
					{shown.map((l, i) => (
						<button key={l.cwd} type="button" role="option" aria-selected={l.cwd === cwd} data-active={i === active || undefined} className="neo-newthread-location" onClick={() => setCwd(l.cwd)} onMouseEnter={() => setActive(i)}>
							{l.note === "typed" ? <FolderPlus size={14} /> : <Folder size={14} />}
							<span className="neo-newthread-location-label">{l.label}</span>
							<span className="neo-mono neo-newthread-location-path">{l.cwd}</span>
							{l.note && l.note !== "typed" ? <span className="neo-newthread-location-note">{l.note}</span> : null}
						</button>
					))}
				</div>
				<p className="neo-newthread-chosen">Working in <span className="neo-mono">{cwd || "nowhere yet"}</span></p>
			</section>

			<section className="neo-newthread-section">
				<h3>Who</h3>
				<p className="neo-newthread-how">Main starts with the thread. Add instances of other templates to talk to them in the same conversation.{agentCatalog.spawnPreview ? " Extra members are preview until NeoPi can start agents from templates." : ""}</p>
				<div className="neo-newthread-members">
					<span className="neo-newthread-member" data-on="true" style={{ "--agent": agentColor(hueFor("Main")) } as CSSProperties}><i />Main</span>
					{templates.map((t) => {
						const on = members.includes(t.id);
						return (
							<button key={t.id} type="button" className="neo-newthread-member" data-on={on || undefined} aria-pressed={on} title={t.description} style={{ "--agent": agentColor(hueFor(t.name)) } as CSSProperties} onClick={() => setMembers((m) => (on ? m.filter((x) => x !== t.id) : [...m, t.id]))}>
								<i />{t.name}
							</button>
						);
					})}
				</div>
			</section>

			<section className="neo-newthread-section">
				<h3>First message <small>optional</small></h3>
				<textarea className="neo-input neo-newthread-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void start(); } }} placeholder="What should the thread start on?" aria-label="First message" />
			</section>

			<footer className="neo-newthread-foot">
				<NeoButton variant="ghost" onClick={onCancel} disabled={busy}>Cancel</NeoButton>
				<NeoButton variant="primary" onClick={() => void start()} disabled={busy || !cwd}>{busy ? "Starting…" : <>Start thread <CornerDownLeft size={13} /></>}</NeoButton>
			</footer>
		</div>
	);
}
