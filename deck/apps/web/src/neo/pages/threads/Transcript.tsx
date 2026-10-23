import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Empty, NeoButton, formatShortRelative } from "@/components/neo";
import { Notice } from "@/components/messages/Notice";
import { CompactionLine } from "@/components/messages/CompactionLine";
import { IrcLine } from "@/components/messages/IrcLine";
import { TtsrLine } from "@/components/messages/TtsrLine";
import { MixtureTraceLine } from "@/components/messages/MixtureTraceLine";
import { QueuedMessage } from "@/components/messages/QueuedMessage";
import { PlanApproval } from "@/components/messages/PlanApproval";
import { ReasoningBlock } from "@/components/messages/ThinkingBlock";
import { ToolCallCard, toolCardFor } from "@/components/tools/ToolCallCard";
import { Markdown } from "@/lib/markdown";
import { reasoningBlockView, reasoningBlockViews, unreportedReasoningView } from "@/lib/reasoning";
import { useStore } from "@/lib/store";
import { MAX_RENDERED, MESSAGE_PAGE, windowRange, type WindowAnchor } from "@/lib/transcript-window";
import { liveReplyId, toolCallWorking } from "@/lib/tool-visibility";
import type { AssistantMsg, SessionUi, ToolCallBlock, ToolCallStream } from "@/lib/types";
import { formatDurationMs, formatTokens } from "@/lib/utils";
import type { ThreadAgent, ThreadMessage } from "../../client/threads";
import { agentColor } from "../../components/AgentSwatch";

interface Props { messages: ThreadMessage[]; agents: readonly ThreadAgent[]; toolCalls: Record<string, ToolCallStream>; everything: boolean; session?: SessionUi }
interface ViewportMark { el: Element | null; top: number; fromBottom: number }
function nearBottom(el: HTMLElement): boolean { return el.scrollHeight - el.scrollTop - el.clientHeight < 100; }
export function Transcript({ messages, agents, toolCalls, everything, session }: Props) {
	const scroll = useRef<HTMLDivElement>(null);
	const sticky = useRef(true);
	const restore = useRef<ViewportMark>();
	const settling = useRef(false);
	const [anchor, setAnchor] = useState<WindowAnchor>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const list = useMemo(() => messages.filter((m) => m.role !== "toolResult"), [messages]);
	const { start, end } = windowRange(list, anchor);
	const shown = list.slice(start, end);
	const live = liveReplyId({ messages, status: session?.status ?? "idle" });
	const newer = list.length - end;
	function settle(): void { requestAnimationFrame(() => { settling.current = false; if (scroll.current) sticky.current = nearBottom(scroll.current); }); }
	function remember(el: HTMLElement): void { const first = el.querySelector("[data-message-id]"); sticky.current = false; settling.current = true; restore.current = { el: first, top: first?.getBoundingClientRect().top ?? 0, fromBottom: el.scrollHeight - el.scrollTop }; }
	useLayoutEffect(() => { const el = scroll.current; const mark = restore.current; if (!el || !mark) return; restore.current = undefined; if (mark.el?.isConnected) el.scrollTop += mark.el.getBoundingClientRect().top - mark.top; else el.scrollTop = el.scrollHeight - mark.fromBottom; settle(); }, [start, end, list]);
	useEffect(() => { const el = scroll.current; if (el && sticky.current && !settling.current) el.scrollTop = el.scrollHeight; }, [list, toolCalls, start, end, session?.queuedPrompts]);
	async function earlier(): Promise<void> {
		const el = scroll.current; if (!el) return;
		remember(el);
		if (start > 0) { const from = Math.max(0, start - MESSAGE_PAGE); setAnchor({ id: list[from]!.id, fromEnd: list.length - from, count: Math.min(end - from, MAX_RENDERED) }); return; }
		if (!session) return;
		setAnchor({ fromEnd: list.length + MESSAGE_PAGE, count: list.length + MESSAGE_PAGE }); setLoading(true);
		try { await useStore.getState().loadEarlierTranscript(session.sessionId); } catch (e) { setError(`Could not load earlier messages. ${String(e)}`); }
		finally { if (useStore.getState().sessionsById[session.sessionId]?.messages === session.messages && restore.current) { restore.current = undefined; settle(); } setLoading(false); }
	}
	return <div ref={scroll} className="neo-threads-transcript" aria-label="Thread transcript" onScroll={() => { const el = scroll.current; if (!el || settling.current) return; sticky.current = nearBottom(el); if (!sticky.current && !anchor?.id && shown[0]) setAnchor({ id: shown[0].id, fromEnd: list.length - start, count: end - start }); else if (sticky.current && anchor?.id && newer === 0) setAnchor({ fromEnd: end - start, count: end - start }); }}><div className="neo-threads-turns">
		{start > 0 || (session?.readOnly?.earlier ?? 0) > 0 ? <NeoButton variant="ghost" size="sm" disabled={loading} onClick={() => void earlier()}>{loading ? "Loading earlier messages…" : start > 0 ? `Show ${Math.min(MESSAGE_PAGE, start)} earlier messages` : "Load earlier messages"}</NeoButton> : null}
		{error ? <p role="alert" className="neo-threads-error">{error}</p> : null}
		{list.length === 0 ? <Empty title="The thread is open" hint="Say something below. Address one member, or @all for everyone." /> : null}
		{shown.map((msg) => <div key={msg.id} data-message-id={msg.id}><Turn msg={msg} agents={agents} toolCalls={toolCalls} everything={everything} live={live === msg.id} /></div>)}
		{newer > 0 ? <NeoButton variant="ghost" onClick={() => { sticky.current = true; setAnchor(undefined); }}>{newer} newer messages · Jump to latest</NeoButton> : null}
		{session?.queuedPrompts.map((q) => <QueuedMessage key={q.id} msg={q} />)}
		{session?.pendingPlanApproval ? <PlanApproval session={session} /> : null}
	</div></div>;
}
function Turn({ msg, agents, toolCalls, everything, live }: { msg: ThreadMessage; agents: readonly ThreadAgent[]; toolCalls: Record<string, ToolCallStream>; everything: boolean; live: boolean }) {
	if (msg.role === "user") return <article className="neo-threads-user-turn"><div className="neo-threads-turn-label">you{msg.addressedTo ? ` to ${msg.addressedTo.join(", ")}` : ""}{msg.timestamp ? ` · ${formatShortRelative(msg.timestamp)}` : ""}</div><div className="neo-thread-user">{msg.images?.length ? <div className="neo-threads-images">{msg.images.map((image, i) => <a key={i} href={`data:${image.mimeType};base64,${image.data}`} target="_blank" rel="noreferrer"><img src={`data:${image.mimeType};base64,${image.data}`} alt={`Attachment ${i + 1}`} /></a>)}</div> : null}<Markdown>{msg.text}</Markdown></div></article>;
	if (msg.role === "assistant") { const agent = agents.find((a) => a.id === (msg.agentId ?? "main")) ?? agents[0]; if (!agent) return null; const starter = agent.spawnedBy ? agents.find((a) => a.id === agent.spawnedBy)?.name ?? "another agent" : undefined; return <AgentTurn msg={msg} agent={agent} starter={starter} toolCalls={toolCalls} everything={everything} live={live} />; }
	return <div className="neo-thread-aside">{msg.role === "notice" ? <Notice msg={msg} /> : msg.role === "compaction" ? <CompactionLine msg={msg} /> : msg.role === "irc" ? <IrcLine msg={msg} /> : msg.role === "ttsr" ? <TtsrLine msg={msg} /> : msg.role === "mixtureTrace" ? <MixtureTraceLine msg={msg} /> : null}</div>;
}
/** Every member's turn renders the same way; who started an agent is a note, not a different style. */
function AgentTurn({ msg, agent, starter, toolCalls, everything, live }: { msg: AssistantMsg; agent: ThreadAgent; starter?: string; toolCalls: Record<string, ToolCallStream>; everything: boolean; live: boolean }) {
	const reasoning = reasoningBlockViews(msg);
	const unreported = unreportedReasoningView(msg);
	const lastText = msg.blocks.findLastIndex((b) => b.type === "text");
	return <article className="neo-threads-agent-turn" style={{ "--agent": agentColor(agent.hue) } as CSSProperties}>
		<div className="neo-threads-turn-label"><strong>{agent.name}</strong><span className="neo-mono">{msg.model ?? agent.model}</span>{msg.usage?.totalTokens ? <span>{formatTokens(msg.usage.totalTokens)} tok</span> : null}{msg.durationMs ? <span>{formatDurationMs(msg.durationMs)}</span> : null}{msg.isStreaming ? <span className="neo-threads-streaming">streaming</span> : null}{starter ? <span>started by {starter}</span> : null}</div>
		{msg.errorMessage ? <p className="neo-threads-error" role="alert">{msg.errorMessage}</p> : null}
		{!msg.blocks.length && msg.isStreaming ? <p className="neo-dim">Thinking…</p> : null}
		<div className="neo-threads-blocks">{unreported ? <ReasoningBlock view={unreported} /> : null}{msg.blocks.map((block, i) => {
			if (block.type === "text") return <Markdown key={i} streaming={msg.isStreaming && i === lastText}>{block.text}</Markdown>;
			if (block.type === "thinking" || block.type === "redactedThinking") return <ReasoningBlock key={i} view={reasoning[i] ?? reasoningBlockView(block, msg)} />;
			if (block.type === "toolCall") return <ToolRow key={block.id} block={block} stream={toolCalls[block.id]} working={toolCallWorking(msg, toolCalls[block.id], live)} everything={everything} />;
			if (block.type === "image") return <img key={i} className="neo-threads-image" src={`data:${block.mimeType};base64,${block.data}`} alt="Agent attachment" />;
			return <details key={i}><summary>Unsupported content: {block.blockType}</summary><pre>{JSON.stringify(block.raw, null, 2)}</pre></details>;
		})}</div>
	</article>;
}
function ToolRow({ block, stream, working, everything }: { block: ToolCallBlock; stream?: ToolCallStream; working: boolean; everything: boolean }) {
	const [open, setOpen] = useState(false);
	const setCardOpen = useStore((s) => s.setToolCardOpen);
	useEffect(() => { if (everything) setCardOpen(block.id, true); }, [everything, block.id, setCardOpen]);
	const summary = block.intent ?? toolCardFor(block.name)?.summary?.(block.arguments) ?? "";
	const effective: ToolCallStream = stream ?? { id: block.id, name: block.name, args: block.arguments, status: working ? "running" : "complete", isError: false, startedAt: 0 };
	if (everything || open) return <div className="neo-threads-tool-card"><ToolCallCard toolCallId={block.id} name={block.name} args={block.arguments} intent={block.intent} stream={effective} />{!everything ? <button type="button" className="neo-threads-tool-fold" onClick={() => setOpen(false)}>Fold tool</button> : null}</div>;
	return <button type="button" className="neo-threads-tool-row" data-error={stream?.isError} aria-expanded={false} onClick={() => { setCardOpen(block.id, true); setOpen(true); }}>{working ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}<span>{block.name}</span><span className="neo-threads-tool-summary">{summary}</span>{stream?.endedAt ? <span>· {formatDurationMs(stream.endedAt - stream.startedAt)}</span> : null}{stream?.isError ? <span>error</span> : null}</button>;
}
