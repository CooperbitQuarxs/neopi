/**
 * `/inbox` — the office's front door.
 *
 * The flow the vision describes (neocore docs/vision/2026-10-20): a thought
 * is a slip of paper you drop in the inbox; it labels itself or you label
 * it; it settles out of the way; later something appears. Here that is:
 * Capture opens a slip at the top of the list; the captured slip lands in
 * the list with its label; only slips that still need you are visible
 * (processed ones hide behind "Show settled"); opening a slip gives it one
 * primary way out, a card on the board, with chat and "done" beside it.
 *
 * Shared vs private, and intake from GitHub / Telegram / dictation, are
 * shown as what they are: a visible split, not yet implemented.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	Archive,
	Check,
	GitBranch,
	Inbox as InboxIcon,
	KanbanSquare,
	LayoutGrid,
	MessageSquarePlus,
	Mic,
	Plus,
	RotateCcw,
	Send,
	Trash2,
	Users,
	X,
} from "lucide-react";
import type { BridgeInfo, InboxHistoryEvent, InboxItem, InboxKind } from "@npi-deck/protocol";

import { ComposePane, KIND_LABEL, KIND_ORDER, KIND_WORD } from "@/components/inbox/ComposePane";
import { InboxRoutingStrip } from "@/components/inbox/InboxRoutingStrip";
import { Layout } from "@/components/Layout";
import { MarkdownEdit } from "@/components/MarkdownEdit";
import { Card, Construction, NeoBadge, NeoButton, NeoSelect, Page, PageHeader, PlannedBadge, Segmented, type NeoTone } from "@/components/neo";
import { bridgesApi } from "@/lib/bridges-api";
import { inboxApi } from "@/lib/inbox-api";
import { useStore } from "@/lib/store";

const KIND_TONE: Partial<Record<InboxKind, NeoTone>> = {
	idea: "accent",
	ticket: "warn",
};

type Filter = InboxKind | "all";
type Scope = "private" | "shared";
type ReaderState =
	| { mode: "empty" }
	| { mode: "item"; item: InboxItem };

export function InboxView() {
	const setInspectorOpen = useStore((s) => s.setInspectorOpen);
	const setPendingDraft = useStore((s) => s.setPendingDraft);
	const createSession = useStore((s) => s.createSession);
	const defaultCwd = useStore((s) => s.defaultCwd);
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	const [items, setItems] = useState<InboxItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [filter, setFilter] = useState<Filter>("all");
	const [showSettled, setShowSettled] = useState(false);
	const [scope, setScope] = useState<Scope>("private");
	const [composing, setComposing] = useState(() => params.get("capture") === "1");
	const [reader, setReader] = useState<ReaderState>({ mode: "empty" });
	const [bridges, setBridges] = useState<BridgeInfo[]>([]);

	// The reader is the second column here; the global inspector stays shut.
	useEffect(() => {
		setInspectorOpen(false);
	}, [setInspectorOpen]);

	// `/inbox?capture=1` (Home's Capture button) opens the slip once, then
	// drops the flag so a reload does not reopen it.
	useEffect(() => {
		if (params.get("capture") !== "1") return;
		setParams((previous) => {
			const next = new URLSearchParams(previous);
			next.delete("capture");
			return next;
		}, { replace: true });
	}, [params, setParams]);

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const opts: { kind?: InboxKind; includeProcessed?: boolean } = { includeProcessed: showSettled };
			if (filter !== "all") opts.kind = filter;
			const res = await inboxApi.list(opts);
			setItems(res.items);
			setReader((prev) => {
				if (prev.mode !== "item") return prev;
				const found = res.items.find((x) => x.id === prev.item.id);
				return found ? { mode: "item", item: found } : { mode: "empty" };
			});
			setError(undefined);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, [filter, showSettled]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		void bridgesApi.list().then((r) => setBridges(r.bridges)).catch(() => setBridges([]));
	}, []);

	const counts = useMemo(() => {
		const m: Record<string, number> = { all: items.length };
		for (const k of KIND_ORDER) m[k] = 0;
		for (const it of items) m[it.kind] = (m[it.kind] ?? 0) + 1;
		return m;
	}, [items]);
	const open = useMemo(() => items.filter((it) => !it.processedAt).length, [items]);

	function replaceItem(updated: InboxItem): void {
		setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
		setReader((prev) => (prev.mode === "item" && prev.item.id === updated.id ? { mode: "item", item: updated } : prev));
	}

	async function toggleSettled(it: InboxItem): Promise<void> {
		try {
			replaceItem(await inboxApi.update(it.id, { processed: !it.processedAt }));
		} catch (e) {
			setError(String(e));
		}
	}

	async function removeItem(it: InboxItem): Promise<void> {
		if (!confirm(`Delete "${it.title}"?`)) return;
		try {
			await inboxApi.remove(it.id);
			setItems((prev) => prev.filter((x) => x.id !== it.id));
			setReader((prev) => (prev.mode === "item" && prev.item.id === it.id ? { mode: "empty" } : prev));
		} catch (e) {
			setError(String(e));
		}
	}

	async function patch(it: InboxItem, body: Parameters<typeof inboxApi.update>[1]): Promise<void> {
		try {
			replaceItem(await inboxApi.update(it.id, body));
		} catch (e) {
			setError(String(e));
		}
	}

	async function openInThread(it: InboxItem): Promise<void> {
		try {
			await createSession({ cwd: defaultCwd });
		} catch (e) {
			console.warn("createSession failed; using draft only", e);
		}
		const stamp = new Date(it.createdAt).toLocaleString();
		const draft = [
			`Inbox · ${it.kind} · captured ${stamp}`,
			``,
			`# ${it.title}`,
			``,
			it.body || "(no body)",
			``,
			`---`,
			`Help me act on this. If it's actionable, propose a concrete next step;`,
			`if it's a decision needing input, frame the choice; if it should become a`,
			`task, POST /api/tasks and report the new task id.`,
		].join("\n");
		setPendingDraft({ text: draft });
		navigate("/legacy/threads");
	}

	async function makeCard(it: InboxItem): Promise<void> {
		try {
			const { task, inbox } = await inboxApi.promote(it.id);
			replaceItem(inbox);
			navigate(`/legacy/tasks?open=${encodeURIComponent(task.id)}`);
		} catch (e) {
			setError(String(e));
		}
	}

	const telegram = bridges.find((b) => b.name === "telegram");

	return (
		<Layout
			sidebar={null}
			inspector={null}
			main={
				<div className="h-full overflow-y-auto">
					<Page>
						<PageHeader
							title="Inbox"
							description="Drop a thought in and choose its kind. New tickets follow your GitHub route. What still needs you stays here."
							actions={
								<>
									<Segmented<Scope>
										label="Which inbox"
										value={scope}
										onChange={setScope}
										options={[
											{ value: "private", label: "Private" },
											{ value: "shared", label: <span className="inline-flex items-center gap-1.5">Shared <PlannedBadge>soon</PlannedBadge></span>, title: "The office's shared inbox arrives with accounts" },
										]}
									/>
									<NeoButton variant="primary" onClick={() => { setScope("private"); setComposing(true); }} disabled={composing}>
										<Plus size={14} /> Capture
									</NeoButton>
								</>
							}
						/>

						<InboxRoutingStrip />

						{scope === "shared" ? (
							<Construction>
								<strong className="text-ink">The shared inbox is not built yet.</strong> It arrives with accounts: one inbox the whole office drops slips
								into, next to each person's private one. Until then every slip here is yours. See <a href="/legacy/people" className="text-accent underline-offset-2 hover:underline">People</a>.
							</Construction>
						) : null}

						{error ? (
							<div role="alert" className="rounded-[var(--r-control)] border border-danger/30 bg-[var(--neo-bad-soft)] px-3 py-2 text-[12.5px] text-danger">{error}</div>
						) : null}

						<div className="neo-grid neo-grid-main-side items-start">
							<Card
								flush
								index={1}
								title={filter === "all" ? "Needs you" : KIND_WORD[filter] + "s"}
								description={loading ? "Loading…" : open === 0 ? "Nothing waiting." : `${open} ${open === 1 ? "slip" : "slips"} waiting${showSettled ? `, ${items.length - open} settled` : ""}`}
								actions={
									<button
										type="button"
										className="neo-chip-btn"
										data-on={showSettled || undefined}
										onClick={() => setShowSettled((v) => !v)}
										aria-pressed={showSettled}
									>
										{showSettled ? "Hide settled" : "Show settled"}
									</button>
								}
								className={scope === "shared" ? "opacity-60" : undefined}
								aria-disabled={scope === "shared" || undefined}
							>
								<div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--neo-line-1)] px-4 py-2.5" role="radiogroup" aria-label="Filter by kind">
									<FilterChip active={filter === "all"} count={counts.all ?? 0} onClick={() => setFilter("all")}>All</FilterChip>
									{KIND_ORDER.map((k) => (
										<FilterChip key={k} active={filter === k} count={counts[k] ?? 0} onClick={() => setFilter(k)}>
											{KIND_LABEL[k][0]!.toUpperCase() + KIND_LABEL[k].slice(1)}
										</FilterChip>
									))}
								</div>
								{composing ? (
									<ComposePane
										initialKind={filter === "all" ? "capture" : filter}
										onClose={() => setComposing(false)}
										onCreated={(it) => {
											setItems((prev) => [it, ...prev]);
											setComposing(false);
											setReader({ mode: "item", item: it });
										}}
									/>
								) : null}
								{loading ? (
									<div className="neo-empty"><div className="neo-empty-hint">Loading…</div></div>
								) : items.length === 0 ? (
									<div className="neo-empty">
										<InboxIcon size={22} />
										<div className="neo-empty-title">{filter === "all" ? "Nothing needs you" : `No ${KIND_LABEL[filter]} waiting`}</div>
										<div className="neo-empty-hint">
											{showSettled ? "Nothing has been captured yet." : "Capture a thought, or show the settled slips to look back."}
										</div>
										{!composing ? (
											<div className="mt-2">
												<NeoButton size="sm" onClick={() => setComposing(true)}><Plus size={13} /> Capture</NeoButton>
											</div>
										) : null}
									</div>
								) : (
									<ul>
										{items.map((it) => (
											<Slip
												key={it.id}
												item={it}
												active={reader.mode === "item" && reader.item.id === it.id}
												onClick={() => setReader({ mode: "item", item: it })}
											/>
										))}
									</ul>
								)}
							</Card>

							{reader.mode === "item" ? (
								<ReaderCard
									item={reader.item}
									onOpenInThread={() => void openInThread(reader.item)}
									onMakeCard={() => void makeCard(reader.item)}
									onSettle={() => void toggleSettled(reader.item)}
									onDelete={() => void removeItem(reader.item)}
									onPatch={(body) => void patch(reader.item, body)}
									onClose={() => setReader({ mode: "empty" })}
								/>
							) : (
								<HowItWorks telegram={telegram} />
							)}
						</div>
					</Page>
				</div>
			}
		/>
	);
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function FilterChip({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
	return (
		<button type="button" role="radio" aria-checked={active} className="neo-chip-btn inline-flex items-center gap-1.5" data-on={active || undefined} onClick={onClick}>
			{children}
			<span className="neo-mono text-ink-3">{count}</span>
		</button>
	);
}

function Slip({ item, active, onClick }: { item: InboxItem; active: boolean; onClick: () => void }) {
	const settled = Boolean(item.processedAt);
	return (
		<li>
			<button type="button" onClick={onClick} className="neo-slip" data-active={active || undefined} data-settled={settled || undefined} aria-current={active || undefined}>
				<span className={settled ? "neo-slip-dot neo-dot opacity-30" : "neo-slip-dot neo-dot"} aria-label={settled ? "settled" : "needs you"} />
				<span className="min-w-0">
					<span className="neo-slip-title block">{item.title || "Untitled"}</span>
					{item.body ? <span className="neo-slip-line block">{firstLine(item.body)}</span> : null}
				</span>
				<span className="neo-slip-meta">
					<NeoBadge tone={KIND_TONE[item.kind]}>{KIND_WORD[item.kind]}</NeoBadge>
					<span className="neo-mono">{formatRelative(item.createdAt)}{item.source ? ` · ${sourceWord(item.source)}` : ""}</span>
				</span>
			</button>
		</li>
	);
}

function ReaderCard({
	item,
	onOpenInThread,
	onMakeCard,
	onSettle,
	onDelete,
	onPatch,
	onClose,
}: {
	item: InboxItem;
	onOpenInThread: () => void;
	onMakeCard: () => void;
	onSettle: () => void;
	onDelete: () => void;
	onPatch: (body: Parameters<typeof inboxApi.update>[1]) => void;
	onClose: () => void;
}) {
	const settled = Boolean(item.processedAt);
	return (
		<Card
			index={2}
			className="lg:sticky lg:top-0"
			data-testid="inbox-reader"
			title={
				<span className="inline-flex items-center gap-2">
					<NeoSelect
						value={item.kind}
						onChange={(e) => onPatch({ kind: e.target.value as InboxKind })}
						size="sm"
						aria-label="Kind"
					>
						{KIND_ORDER.map((k) => (
							<option key={k} value={k}>
								{KIND_WORD[k]}
							</option>
						))}
					</NeoSelect>
					{settled ? <NeoBadge>settled</NeoBadge> : <NeoBadge tone="accent">needs you</NeoBadge>}
				</span>
			}
			actions={
				<>
					<NeoButton variant="ghost" size="sm" icon onClick={onSettle} aria-label={settled ? "Put it back" : "Mark settled"} title={settled ? "Put it back in the inbox" : "Settle it: done, nothing to build"}>
						{settled ? <RotateCcw size={14} /> : <Archive size={14} />}
					</NeoButton>
					<NeoButton variant="ghost" size="sm" icon onClick={onDelete} aria-label="Delete" title="Delete" className="hover:!text-danger">
						<Trash2 size={14} />
					</NeoButton>
					<NeoButton variant="ghost" size="sm" icon onClick={onClose} aria-label="Close" title="Close">
						<X size={14} />
					</NeoButton>
				</>
			}
			footer={
				<div className="flex flex-wrap items-center gap-2">
					<NeoButton variant="primary" size="sm" onClick={onMakeCard} disabled={settled} title="Put it on the board as a card">
						<KanbanSquare size={13} /> Make a card
					</NeoButton>
					<NeoButton size="sm" onClick={onOpenInThread} title="Open a thread with this slip as the first message">
						<MessageSquarePlus size={13} /> Open in a thread
					</NeoButton>
					{!settled ? (
						<NeoButton variant="ghost" size="sm" onClick={onSettle} className="ml-auto">
							<Check size={13} /> Done
						</NeoButton>
					) : null}
				</div>
			}
		>
			<input
				value={item.title}
				onChange={(e) => onPatch({ title: e.target.value })}
				className="neo-reader-title"
				placeholder="Untitled"
				aria-label="Title"
			/>
			<div className="neo-mono mt-1.5 text-[11.5px] text-ink-3">
				captured {new Date(item.createdAt).toLocaleString()}
				{item.source ? ` · from ${sourceWord(item.source)}` : ""}
				{item.processedAt ? ` · settled ${new Date(item.processedAt).toLocaleString()}` : ""}
			</div>
			<FilingHistory key={item.id} item={item} />
			<div className="mt-4 border-t border-[var(--neo-line-1)] pt-4">
				<MarkdownEdit
					value={item.body}
					onChange={(next) => onPatch({ body: next })}
					placeholder="Click to add notes…"
				/>
			</div>
		</Card>
	);
}

/** The right column when no slip is open: how the inbox works and where slips come from. */
function HowItWorks({ telegram }: { telegram: BridgeInfo | undefined }) {
	const telegramOn = telegram?.status === "running";
	return (
		<div className="flex flex-col gap-4">
			<Card index={2} title="How a slip moves" description="Pick a slip on the left to read it, or capture a new one.">
				<ol className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
					<li className="flex gap-2.5"><span className="neo-mono text-ink-4">1</span><span><span className="text-ink">Drop it in.</span> A title is enough; the body can wait.</span></li>
					<li className="flex gap-2.5"><span className="neo-mono text-ink-4">2</span><span><span className="text-ink">Choose its kind.</span> Capture, idea, ticket, decision… routing uses your explicit choice.</span></li>
					<li className="flex gap-2.5"><span className="neo-mono text-ink-4">3</span><span><span className="text-ink">It settles.</span> Make a card and an agent picks it up; or mark it done and it leaves this list.</span></li>
					<li className="flex gap-2.5"><span className="neo-mono text-ink-4">4</span><span><span className="text-ink">Something appears.</span> A card moves, a feature lands in nightly.</span></li>
				</ol>
			</Card>
			<Card index={3} title="Where slips come from" description="The deck is the front door; the others are being wired.">
				<div className="neo-intake">
					<div className="neo-intake-row"><LayoutGrid size={14} /><span>This deck</span><NeoBadge tone="ok">on</NeoBadge></div>
					<div className="neo-intake-row"><Send size={14} /><span>Telegram</span>{telegramOn ? <NeoBadge tone="ok">bridge running</NeoBadge> : <NeoBadge>bridge off</NeoBadge>}</div>
					<div className="neo-intake-row"><GitBranch size={14} /><span>GitHub issues</span><PlannedBadge /></div>
					<div className="neo-intake-row"><Mic size={14} /><span>Dictation</span><PlannedBadge /></div>
					<div className="neo-intake-row"><Users size={14} /><span>Shared office inbox</span><PlannedBadge /></div>
				</div>
			</Card>
		</div>
	);
}

function FilingHistory({ item }: { item: InboxItem }) {
	const [events, setEvents] = useState<InboxHistoryEvent[]>([]);
	const [error, setError] = useState("");
	const [reload, setReload] = useState(0);
	useEffect(() => {
		let alive = true;
		setError("");
		void inboxApi.history(item.id).then(result => {
			if (alive) setEvents(result.events);
		}).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
		return () => { alive = false; };
	}, [item.id, item.processedAt, item.filing?.url, reload]);
	const receipts = [...(item.filing ? [item.filing] : []), ...events.flatMap(event => event.receipt ? [event.receipt] : [])];
	const links = receipts.filter((receipt, index) => receipts.findIndex(other => other.url === receipt.url) === index);
	if (!links.length && !error) return null;
	return <div className="mt-4 space-y-2 border-t border-[var(--neo-line-1)] pt-3 text-[12.5px]">
		{links.length ? <div><p className="mb-1 text-ink-3">Confirmed filing</p><ul className="space-y-1">{links.map(receipt => <li key={receipt.url}><a href={receipt.url} target={receipt.kind === "issue" ? "_blank" : undefined} rel={receipt.kind === "issue" ? "noopener noreferrer" : undefined} className="break-all text-accent hover:underline">{receipt.label || receipt.ref}</a></li>)}</ul></div> : null}
		{error ? <p role="alert" className="text-danger">Could not load filing history. {error} <NeoButton size="sm" onClick={() => setReload(value => value + 1)}>Retry history</NeoButton></p> : null}
	</div>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function firstLine(body: string): string {
	const line = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
	return line.replace(/^[#>*\-\s]+/, "").slice(0, 140);
}

function sourceWord(source: string): string {
	if (source.startsWith("routine:")) return `routine ${source.slice("routine:".length)}`;
	return source;
}

function formatRelative(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const diff = Date.now() - d.getTime();
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
	if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d`;
	return d.toLocaleDateString();
}
