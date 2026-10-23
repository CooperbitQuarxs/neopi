import { useEffect, useState } from "react";
import { Clock, GitBranch, Inbox, KanbanSquare, MessagesSquare, Send, Users, Workflow, Zap } from "lucide-react";
import type { BridgeInfo, InboxItem, Routine, Task, TaskState } from "@npi-deck/protocol";
import { Layout } from "@/components/Layout";
import { Card, Construction, NeoBadge, NeoLinkButton, Page, PageHeader, Stat, StatGrid } from "@/components/neo";
import { bridgesApi } from "@/lib/bridges-api";
import { inboxApi } from "@/lib/inbox-api";
import { routinesApi } from "@/lib/routines-api";
import { tasksApi } from "@/lib/tasks-api";
import { useStore } from "@/lib/store";

interface Snapshot {
	inbox: InboxItem[];
	tasks: Task[];
	states: TaskState[];
	routines: Routine[];
	bridges: BridgeInfo[];
}

/**
 * `/` — the cockpit's first screen. One row of numbers that answer "what
 * needs me", then three cards: what is unread, what is moving on the board,
 * and the engine. Every number is a link into the page it came from.
 */
export function HomeView() {
	const [snap, setSnap] = useState<Snapshot | null>(null);
	const backend = useStore((s) => s.backend);
	const sessions = useStore((s) => s.sessions);
	const tasksCounter = useStore((s) => s.tasksChangeCounter);

	useEffect(() => {
		let cancelled = false;
		void Promise.all([
			inboxApi.list().catch(() => ({ items: [] as InboxItem[] })),
			tasksApi.list().catch(() => ({ tasks: [] as Task[], states: [] as TaskState[], projects: [] })),
			routinesApi.list().catch(() => ({ routines: [] as Routine[] })),
			bridgesApi.list().catch(() => ({ bridges: [] as BridgeInfo[] })),
		]).then(([inbox, tasks, routines, bridges]) => {
			if (!cancelled) setSnap({ inbox: inbox.items, tasks: tasks.tasks, states: tasks.states, routines: routines.routines, bridges: bridges.bridges });
		});
		return () => {
			cancelled = true;
		};
	}, [tasksCounter]);

	const unread = snap?.inbox.filter((i) => !i.processedAt) ?? [];
	const defaultState = snap?.states.find((s) => s.isDefault);
	const inFlight = snap?.tasks.filter((t) => t.stateId !== defaultState?.id && !isDoneState(snap.states, t.stateId)) ?? [];
	const enabledRoutines = snap?.routines.filter((r) => r.enabled) ?? [];
	const telegram = snap?.bridges.find((b) => b.name === "telegram");

	return (
		<Layout
			sidebar={null}
			inspector={null}
			main={
				<div className="h-full overflow-y-auto">
					<Page>
						<PageHeader
							title="Home"
							description="Everything the office needs you for, in one place. Numbers link to where they come from."
							actions={
								<>
									<NeoLinkButton to="/legacy/inbox?capture=1" variant="primary">
										<Inbox size={14} /> Capture
									</NeoLinkButton>
									<NeoLinkButton to="/legacy/threads">
										<MessagesSquare size={14} /> New thread
									</NeoLinkButton>
								</>
							}
						/>

						<StatGrid>
							<Stat label="Unread inbox" value={snap ? unread.length : "–"} foot={snap ? `${snap.inbox.length} total` : "loading"} to="/legacy/inbox" icon={Inbox} />
							<Stat label="In flight" value={snap ? inFlight.length : "–"} foot={snap ? `${snap.tasks.length} cards on the board` : "loading"} to="/legacy/tasks" icon={KanbanSquare} />
							<Stat label="Threads" value={backend ? sessions.length : "–"} foot={backend ? "in this workspace" : "needs an engine"} to="/legacy/threads" icon={MessagesSquare} />
							<Stat label="Routines" value={snap ? enabledRoutines.length : "–"} foot={snap ? `${snap.routines.length} defined, ${enabledRoutines.length} enabled` : "loading"} to="/legacy/routines" icon={Clock} />
							<Stat label="Engine" value={backend ? "NeoPi" : "none"} foot={backend ? (backend.version ?? backend.commit?.slice(0, 7) ?? backend.path) : "attach one on the NeoPi page"} to="/settings#engine" icon={Zap} />
						</StatGrid>

						<div className="neo-grid neo-grid-main-side items-start">
							<Card
								title="Inbox"
								description={unread.length ? "Newest first. Open one to read, label, or promote it." : "Nothing waiting. Capture a thought and it lands here."}
								actions={<NeoLinkButton to="/legacy/inbox" size="sm">All items</NeoLinkButton>}
								flush
								index={1}
							>
								{unread.length ? (
									<table className="neo-table">
										<tbody>
											{unread.slice(0, 8).map((item) => (
												<tr key={item.id}>
													<td className="w-[1%]">
														<NeoBadge mono>{item.kind}</NeoBadge>
													</td>
													<td data-wrap="true" className="neo-cell-primary">
														{item.title}
													</td>
													<td data-align="right" className="neo-cell-secondary">
														{relative(item.createdAt)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								) : (
									<div className="neo-empty" style={{ minHeight: 120 }}>
										<div className="neo-empty-title">Inbox zero</div>
									</div>
								)}
							</Card>

							<div className="flex flex-col gap-4">
								<Card title="Board" description="Cards by column." actions={<NeoLinkButton to="/legacy/tasks" size="sm">Open</NeoLinkButton>} index={2}>
									{snap && snap.states.length ? (
										<ul className="flex flex-col gap-2">
											{snap.states.map((state) => {
												const n = snap.tasks.filter((t) => t.stateId === state.id).length;
												return (
													<li key={state.id} className="flex items-center gap-2 text-[13px]">
														<span className="neo-dot" style={{ background: state.color }} />
														<span className="flex-1 text-ink-2">{state.name}</span>
														<span className="neo-mono text-ink">{n}</span>
													</li>
												);
											})}
										</ul>
									) : (
										<div className="neo-micro">loading</div>
									)}
								</Card>
								<Card title="Connections" index={3}>
									<ul className="flex flex-col gap-2 text-[13px]">
										<Row icon={Zap} label="NeoPi engine" to="/settings#engine" tone={backend ? "ok" : "warn"} status={backend ? "attached" : "none"} />
										<Row icon={Send} label="Telegram" to="/legacy/telegram" tone={telegram?.status === "running" ? "ok" : undefined} status={telegram ? telegram.status : "not set up"} />
										<Row icon={GitBranch} label="GitHub" to="/legacy/github" tone="planned" status="planned" />
										<Row icon={Workflow} label="Flows" to="/legacy/flows" tone="planned" status="planned" />
										<Row icon={Users} label="People" to="/legacy/people" tone="planned" status="planned" />
									</ul>
								</Card>
							</div>
						</div>

						{!backend ? (
							<Construction>
								No NeoPi engine is attached to this deck, so threads and agent-backed routines are unavailable. Inbox, board, routines and settings keep
								working. Attach a source tree on the <a className="text-accent underline underline-offset-2" href="/settings#engine">NeoPi page</a>.
							</Construction>
						) : null}
					</Page>
				</div>
			}
		/>
	);
}

function Row({ icon: Icon, label, to, status, tone }: { icon: typeof Zap; label: string; to: string; status: string; tone?: "ok" | "warn" | "planned" }) {
	return (
		<li className="flex items-center gap-2">
			<Icon size={14} className="text-ink-3" />
			<a href={to} className="flex-1 text-ink-2 hover:text-ink">
				{label}
			</a>
			<NeoBadge tone={tone}>{status}</NeoBadge>
		</li>
	);
}

function isDoneState(states: TaskState[], id: string): boolean {
	const last = [...states].sort((a, b) => a.position - b.position).at(-1);
	return last?.id === id;
}

function relative(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const m = Math.round(ms / 60000);
	if (m < 1) return "now";
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}
