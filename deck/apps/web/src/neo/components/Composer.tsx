/**
 * The composer: docked to the frame, opaque, a fixed height that never grows.
 * Three lines of text (longer drafts scroll inside), then one bar: who the
 * message goes to, which model, dictation, send. An optional facts row under
 * it carries the session's numbers (model, effort, speed, cache, context,
 * cost) so they sit where the eye already is.
 *
 * Addressing: the "To" control lists everyone in the thread, all as equals.
 * Typing `@name ` (or `@all `) at the start of the draft re-addresses it and
 * drops the mention. `Ctrl+]` / `Ctrl+[` cycle the address; `Enter` sends,
 * `Shift+Enter` breaks a line.
 */
import "./composer.css";
import { ArrowUp, Check, Mic, Square } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Kbd, NeoButton, NeoPopover } from "@/components/neo";
import { cn } from "@/lib/utils";
import { dictation, DictationUnavailable } from "../client/dictation";
import { agentColor } from "./AgentSwatch";
import { ModelPicker } from "./ModelPicker";

export interface ComposerTarget {
	id: string;
	name: string;
	hue: number;
	/** Shown beside the name in the address list, e.g. the model. */
	detail?: string;
}

export const ALL_TARGETS = "all";

export interface ComposerProps {
	targets: readonly ComposerTarget[];
	/** An agent id, or `ALL_TARGETS` to address every agent in the thread. */
	targetId: string;
	onTargetChange: (id: string) => void;
	model: string;
	onModelChange: (model: string) => void;
	onSend: (text: string) => void | Promise<void>;
	/** The target is busy: Send becomes Stop. */
	busy?: boolean;
	onStop?: () => void;
	disabled?: boolean;
	placeholder?: string;
	/** Prefilled text, e.g. from `Open in thread`. */
	draft?: string;
	/** Native scope for the model picker: the live session (only when active) and the project path. */
	sessionId?: string;
	cwd?: string;
	/** The session's numbers, rendered as a row under the bar. */
	facts?: ReactNode;
	className?: string;
}

/** `@name ` at the start of a draft: the member it names, or ALL_TARGETS. */
export function mentionTarget(text: string, targets: readonly ComposerTarget[]): { id: string; rest: string } | null {
	const match = /^@([\w.-]+)\s/.exec(text);
	if (!match) return null;
	const name = match[1]!.toLowerCase();
	if (name === "all" || name === "everyone") return targets.length > 1 ? { id: ALL_TARGETS, rest: text.slice(match[0].length) } : null;
	const hit = targets.find((t) => t.name.toLowerCase() === name || t.name.toLowerCase().replace(/\s+/g, "") === name);
	return hit ? { id: hit.id, rest: text.slice(match[0].length) } : null;
}

export function Composer({ targets, targetId, onTargetChange, model, onModelChange, onSend, busy, onStop, disabled, placeholder, draft, facts, sessionId, cwd, className }: ComposerProps) {
	const [text, setText] = useState(draft ?? "");
	const [note, setNote] = useState<string | null>(null);
	const [addressing, setAddressing] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const toRef = useRef<HTMLButtonElement>(null);
	const target = targets.find((t) => t.id === targetId);
	const broadcast = targetId === ALL_TARGETS;
	const options = [...(targets.length > 1 ? [{ id: ALL_TARGETS, name: "Everyone", hue: -1, detail: `all ${targets.length}` }] : []), ...targets];

	useEffect(() => {
		if (draft !== undefined) setText(draft);
	}, [draft]);

	useEffect(() => {
		if (!note) return;
		const t = setTimeout(() => setNote(null), 4000);
		return () => clearTimeout(t);
	}, [note]);

	function cycle(delta: 1 | -1): void {
		const ids = options.map((t) => t.id);
		if (ids.length < 2) return;
		const i = ids.indexOf(targetId);
		onTargetChange(ids[(i + delta + ids.length) % ids.length]!);
	}

	function change(value: string): void {
		const mention = mentionTarget(value, targets);
		if (mention) { onTargetChange(mention.id); setText(mention.rest); return; }
		setText(value);
	}

	async function send(): Promise<void> {
		const value = text.trim();
		if (!value || disabled) return;
		setText("");
		await onSend(value);
		ref.current?.focus();
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
		if ((e.ctrlKey || e.metaKey) && (e.key === "]" || e.key === "[")) {
			e.preventDefault();
			cycle(e.key === "]" ? 1 : -1);
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void send();
		}
	}

	const { listening, toggle } = useDictation((spoken) => setText((t) => (t ? `${t} ${spoken}` : spoken)), setNote);
	const toColor = broadcast ? "var(--neo-accent-b)" : agentColor(target?.hue ?? 0);

	return (
		<div className={cn("neo-composer", className)} data-disabled={disabled || undefined} data-facts={facts ? "" : undefined}>
			<textarea
				ref={ref}
				className="neo-composer-text"
				rows={3}
				value={text}
				placeholder={placeholder ?? (broadcast ? "Message everyone in this thread" : target ? `Message ${target.name}${targets.length > 1 ? " · @name to address someone else" : ""}` : "Message")}
				onChange={(e) => change(e.target.value)}
				onKeyDown={onKey}
				disabled={disabled}
				aria-label="Message"
			/>
			<div className="neo-composer-bar">
				{targets.length > 0 ? (
					<>
						<button
							ref={toRef}
							type="button"
							className="neo-chip neo-composer-target"
							onClick={() => setAddressing((v) => !v)}
							aria-haspopup="listbox"
							aria-expanded={addressing}
							title={options.length > 1 ? "Who gets this message · ctrl+] next, ctrl+[ previous" : "Who gets this message"}
							style={{ "--agent": toColor } as CSSProperties}
							disabled={disabled}
						>
							<span className="neo-composer-arrow" aria-hidden="true">To</span>
							<i className="neo-composer-dot" aria-hidden="true" />
							<span>{broadcast ? `Everyone · ${targets.length}` : (target?.name ?? "No agent")}</span>
						</button>
						<NeoPopover open={addressing} onClose={() => setAddressing(false)} anchorRef={toRef} side="top" align="start" width={280} className="neo-composer-to">
							<div role="listbox" aria-label="Address the message to" onKeyDown={(e) => { if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return; e.preventDefault(); const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const i = rows.indexOf(document.activeElement as HTMLButtonElement); rows[(i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus(); }}>
								{options.map((o) => (
									<button
										key={o.id}
										type="button"
										role="option"
										aria-selected={o.id === targetId}
										className="neo-composer-to-row"
										style={{ "--agent": o.id === ALL_TARGETS ? "var(--neo-accent-b)" : agentColor(o.hue) } as CSSProperties}
										onClick={() => { onTargetChange(o.id); setAddressing(false); ref.current?.focus(); }}
									>
										<i className="neo-composer-dot" aria-hidden="true" />
										<span className="neo-composer-to-name">{o.name}</span>
										{o.detail ? <span className="neo-composer-to-detail">{o.detail}</span> : null}
										{o.id === targetId ? <Check size={13} /> : null}
									</button>
								))}
							</div>
						</NeoPopover>
					</>
				) : null}
				<ModelPicker value={model} onChange={onModelChange} above size="sm" disabled={disabled} sessionId={sessionId} cwd={cwd} />
				<span className="neo-composer-spacer" />
				{note ? (
					<span className="neo-composer-note" role="status">
						{note}
					</span>
				) : options.length > 1 ? (
					<span className="neo-composer-hint">
						<Kbd>@</Kbd> or <Kbd>ctrl</Kbd>
						<Kbd>]</Kbd> to address
					</span>
				) : null}
				<NeoButton variant="ghost" icon size="sm" on={listening} onClick={toggle} aria-label={listening ? "Stop dictating" : "Dictate"} title={listening ? "Stop dictating" : "Dictate (hold to talk)"} disabled={disabled}>
					<Mic size={14} />
					{listening ? <i className="neo-composer-listening" aria-hidden="true" /> : null}
				</NeoButton>
				{busy ? (
					<NeoButton variant="danger" size="sm" onClick={onStop} aria-label="Stop" title="Stop the current turn · ctrl+.">
						<Square size={12} /> Stop
					</NeoButton>
				) : (
					<NeoButton variant="primary" size="sm" className="neo-composer-send" onClick={() => void send()} disabled={disabled || text.trim() === ""} aria-label="Send" title="Send · enter">
						<ArrowUp size={14} />
					</NeoButton>
				)}
			</div>
			{facts ? <div className="neo-composer-facts">{facts}</div> : null}
		</div>
	);
}

/** Records with MediaRecorder while on; on stop, sends the clip to the dictation client. */
function useDictation(onText: (text: string) => void, onNote: (note: string) => void): { listening: boolean; toggle: () => void } {
	const [listening, setListening] = useState(false);
	const recorder = useRef<MediaRecorder | null>(null);

	async function start(): Promise<void> {
		if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			onNote("This browser has no microphone access.");
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const chunks: Blob[] = [];
			const rec = new MediaRecorder(stream);
			rec.ondataavailable = (e) => chunks.push(e.data);
			rec.onstop = async () => {
				for (const track of stream.getTracks()) track.stop();
				setListening(false);
				try {
					const text = await dictation.transcribe(new Blob(chunks, { type: rec.mimeType }));
					if (text.trim()) onText(text.trim());
				} catch (err) {
					onNote(err instanceof DictationUnavailable ? err.message : "Transcription failed.");
				}
			};
			rec.start();
			recorder.current = rec;
			setListening(true);
		} catch {
			onNote("Microphone permission was refused.");
		}
	}

	function toggle(): void {
		if (listening) {
			recorder.current?.stop();
			recorder.current = null;
		} else {
			void start();
		}
	}

	return { listening, toggle };
}
