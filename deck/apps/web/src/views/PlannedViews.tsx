import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BridgeInfo } from "@npi-deck/protocol";
import { Layout } from "@/components/Layout";
import { Card, Construction, KeyValue, NeoBadge, NeoLinkButton, Page, PageHeader, PlannedBadge } from "@/components/neo";
import { bridgesApi } from "@/lib/bridges-api";
import { useStore } from "@/lib/store";

/**
 * Real routed pages for the areas the 2026-10-20 vision names and the deck
 * does not have yet. Each says what it will be, what exists today that it
 * builds on, and that it is not implemented. They are honest signposts, not
 * mockups: nothing here pretends to work.
 *
 * Vision source: neocore/docs/vision/2026-10-20-neo-vision-verbatim.md and
 * the 2026-10-13 captain brief.
 */

function Planned({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
	return (
		<Layout
			sidebar={null}
			inspector={null}
			main={
				<div className="h-full overflow-y-auto">
					<Page>
						<PageHeader title={title} description={summary} badge={<PlannedBadge />} />
						<Construction>
							<strong className="text-ink">Not implemented yet.</strong> This page exists so the deck's shape is visible before the code is. What is
							written below is the plan, not a feature.
						</Construction>
						{children}
					</Page>
				</div>
			}
		/>
	);
}

function Plan({ items }: { items: ReadonlyArray<{ h: string; p: string }> }) {
	return (
		<div className="neo-grid neo-grid-2">
			{items.map((item, i) => (
				<Card key={item.h} title={item.h} index={i + 1}>
					<p className="text-[13.5px] leading-relaxed text-ink-2">{item.p}</p>
				</Card>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ People */

export function PeopleView() {
	return (
		<Planned title="People" summary="User accounts, sign-in, and who may touch what. The office logs into one NeoDeck on the office server.">
			<Plan
				items={[
					{ h: "Accounts", p: "Each person signs in with a username. Private inbox, own threads and own drafts; the shared inbox and board are visible to the team." },
					{ h: "Permissions", p: "Restriction is the primitive, freedom the grant: who can read whose threads, kill whose agents, spawn with which models. The same mechanism NeoPi's agents will use." },
					{ h: "One identity", p: "Open question from the vision: NeoDeck accounts, NeoProxy's admin login and NeoPi's auth broker are three logins today. One identity or federated is undecided." },
					{ h: "What exists now", p: "Nothing. The deck is single-user; the server trusts every request on its port." },
				]}
			/>
		</Planned>
	);
}

/* ------------------------------------------------------------------ GitHub */

export function GitHubView() {
	return (
		<Planned title="GitHub" summary="First-class issues and pull requests: the office files work here and the Ferris wheel of implementation turns on it.">
			<Plan
				items={[
					{ h: "Intake", p: "An inbox item becomes a GitHub issue with one action; a ticket filed from Telegram lands the same way. Labels, repo and priority are chosen for you unless you say otherwise." },
					{ h: "Pull requests", p: "PRs opened by agents appear on the board as cards that move as review and merge happen; the owner's promotion decision stays hers." },
					{ h: "Auth", p: "Sign in through NeoPi's auth gateway, which already holds the GitHub credential, instead of a second token store in the deck." },
					{ h: "What exists now", p: "Nothing deck-side. NeoPi has the gh plumbing; the deck has the board and inbox this will connect to." },
				]}
			/>
		</Planned>
	);
}

/* ------------------------------------------------------------------ Flows */

export function FlowsView() {
	return (
		<Planned title="Flows" summary="The implementation loop run by hand in tmux today, as a visible graph the board's cards travel through.">
			<Plan
				items={[
					{ h: "A flow is a template", p: "Issue → implementer → reviewer → canary → merge, as a class you instantiate per repository. Cards are visible on each node while they wait there." },
					{ h: "Built on the canvas", p: "The routines canvas (React Flow) is the editor; a flow is a routine whose steps are agents and whose edges carry cards, not just control." },
					{ h: "Agents as equals", p: "Every node is just an agent with restrictions applied at spawn time: model, role, what it may see or kill. No hard-coded roles." },
					{ h: "What exists now", p: "Routines with agent, command and deck steps, and card agents on the board. The orchestration itself still lives in tmux." },
				]}
			/>
			<div className="flex gap-2">
				<NeoLinkButton to="/legacy/routines">Open the routines canvas</NeoLinkButton>
				<NeoLinkButton to="/legacy/tasks">Open the board</NeoLinkButton>
			</div>
		</Planned>
	);
}

/* ------------------------------------------------------------------ Telegram */

export function TelegramView() {
	const [bridge, setBridge] = useState<BridgeInfo | null | undefined>(undefined);
	useEffect(() => {
		void bridgesApi
			.list()
			.then((r) => setBridge(r.bridges.find((b) => b.name === "telegram") ?? null))
			.catch(() => setBridge(null));
	}, []);
	const status = bridge?.status;
	return (
		<Layout
			sidebar={null}
			inspector={null}
			main={
				<div className="h-full overflow-y-auto">
					<Page>
						<PageHeader
							title="Telegram"
							description="Talk to the deck from your phone: today a chat bridge, tomorrow an intake channel and group chat."
							actions={<NeoLinkButton to="/legacy/settings?section=messaging">Bridge settings</NeoLinkButton>}
						/>
						<Card
							title="Bridge"
							description="The standalone Telegram process supervised by the deck."
							actions={
								<NeoBadge tone={status === "running" ? "ok" : status === "crashed" ? "bad" : undefined}>
									{bridge === undefined ? "checking" : bridge === null ? "not configured" : status}
								</NeoBadge>
							}
						>
							{bridge ? (
								<KeyValue
									items={[
										{ key: "status", value: bridge.status },
										{ key: "pid", value: bridge.pid ?? "–" },
										{ key: "started", value: bridge.startedAt ?? "–" },
										{ key: "stopped", value: bridge.stoppedAt ?? "–" },
									]}
								/>
							) : (
								<p className="text-[13px] text-ink-2">
									No bridge is set up. Add a bot token under <Link className="text-accent underline underline-offset-2" to="/legacy/settings?section=messaging">Settings → Messaging</Link> and
									start it there.
								</p>
							)}
						</Card>
						<Construction>
							<strong className="text-ink">Planned, not built:</strong> captures from a Telegram topic landing in the inbox, per-user routing once accounts exist,
							and group chat with several agents in one topic (the Hermes/GrokBot idea, done without the bloat).
						</Construction>
					</Page>
				</div>
			}
		/>
	);
}

/* ------------------------------------------------------------------ NeoPi */

export function NeoPiView() {
	const backend = useStore((s) => s.backend);
	const heartbeat = useStore((s) => s.heartbeat);
	return (
		<Layout
			sidebar={null}
			inspector={null}
			main={
				<div className="h-full overflow-y-auto">
					<Page>
						<PageHeader
							title={<span className="neo-gradient-text">NeoPi</span>}
							description="The engine. Auth, credentials, models and inference all come from NeoPi; the deck is one of its surfaces."
							actions={<NeoLinkButton to="/legacy/settings?section=backend">Backend settings</NeoLinkButton>}
						/>
						<div className="neo-grid neo-grid-2">
							<Card title="Attached engine" tone="accent" actions={<NeoBadge tone={backend ? "ok" : "warn"}>{backend ? "attached" : "none"}</NeoBadge>} index={1}>
								{backend ? (
									<KeyValue
										items={[
											{ key: "version", value: backend.version ?? "–" },
											{ key: "commit", value: backend.commit?.slice(0, 12) ?? "–" },
											{ key: "source", value: backend.source },
											{ key: "path", value: backend.path },
										]}
									/>
								) : (
									<p className="text-[13px] text-ink-2">
										No NeoPi source tree is loaded. Threads and agent steps need one; inbox, board and routines work without it. Choose a tree under{" "}
										<Link className="text-accent underline underline-offset-2" to="/legacy/settings?section=backend">Settings → Backend</Link>.
									</p>
								)}
							</Card>
							<Card title="Deck server" index={2}>
								<KeyValue
									items={[
										{ key: "heartbeat", value: heartbeat ? "live" : "none yet" },
										{ key: "started", value: heartbeat?.serverStartedAt ?? "–" },
										{ key: "pid", value: heartbeat?.pid ?? "–" },
									]}
								/>
							</Card>
						</div>
						<Card title="Where this is going" description="From the vision documents; none of it is built." index={3}>
							<ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink-2">
								<li>
									<strong className="text-ink">Core daemon.</strong> A persistent <code className="neo-mono">npi core</code> serving auth, inference and agents over a socket; the deck attaches to it
									instead of importing a source tree in-process.
								</li>
								<li>
									<strong className="text-ink">Hosted threads.</strong> Threads run on the office server, not on the laptop in front of you.
								</li>
								<li id="dictation">
									<strong className="text-ink">Dictation everywhere.</strong> Every text field takes speech through xAI's STT, with a local Parakeet fallback on the office GPU. The
									microphone in the topbar is the affordance; it is not wired.
								</li>
								<li>
									<strong className="text-ink">Usage and cost.</strong> NeoPi already tracks both in <code className="neo-mono">/stats</code>; the deck will show the office's share here.
								</li>
							</ul>
						</Card>
					</Page>
				</div>
			}
		/>
	);
}
