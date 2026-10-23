/**
 * Trigger picker. Edits a routine's `trigger:` array (cron, webhook, manual).
 * Event triggers are reserved in the schema for V1.5 — not surfaced here yet.
 */
import { useEffect, useState } from "react";
import { Clock, Play, Plus, Trash2, Webhook } from "lucide-react";

import type { RoutineTrigger } from "@npi-deck/protocol";

import { Field, TextInput } from "./form-primitives";
import { cronInWords, describeTrigger, triggerKind, type TriggerKind } from "./trigger-summary";

interface Props {
	triggers: RoutineTrigger[];
	onChange: (next: RoutineTrigger[]) => void;
	/** Validation message for the trigger list as a whole. */
	error?: string;
}

const PRESET_CRONS: ReadonlyArray<{ label: string; expr: string }> = [
	{ label: "Every minute", expr: "* * * * *" },
	{ label: "Hourly", expr: "0 * * * *" },
	{ label: "Daily 07:00", expr: "0 7 * * *" },
	{ label: "Weekdays 09:00", expr: "0 9 * * 1-5" },
	{ label: "Sundays 09:00", expr: "0 9 * * 0" },
];

const KIND_ICON = { cron: Clock, webhook: Webhook, manual: Play, event: Clock } as const;
const KIND_WORDS: Record<TriggerKind, string> = { cron: "On a schedule", webhook: "From a webhook", manual: "By hand", event: "On an event" };

export function TriggerPicker({ triggers, onChange, error }: Props) {
	function add(kind: "cron" | "webhook" | "manual"): void {
		const next = triggers.slice();
		if (kind === "cron") next.push({ cron: "0 9 * * *" });
		else if (kind === "webhook") {
			const path = `/hooks/${Math.random().toString(36).slice(2, 10)}`;
			next.push({ webhook: { path, secret_env: "ROUTINE_WEBHOOK_SECRET" } });
		} else next.push({ manual: {} });
		onChange(next);
	}
	function remove(idx: number): void {
		const next = triggers.slice();
		next.splice(idx, 1);
		onChange(next);
	}
	function replace(idx: number, t: RoutineTrigger): void {
		const next = triggers.slice();
		next[idx] = t;
		onChange(next);
	}

	return (
		<div className="space-y-3">
			<Field
				label="Starts"
				help={triggers.length === 0 ? "A routine needs at least one way to start." : "Any of these starts the routine."}
				error={error ?? (triggers.length === 0 ? "Add at least one trigger." : undefined)}
			>
				<div className="space-y-2">
					{triggers.map((t, idx) => (
						<TriggerCard key={idx} trigger={t} onChange={(v) => replace(idx, v)} onRemove={() => remove(idx)} />
					))}
				</div>
			</Field>
			<div className="flex flex-wrap gap-1.5">
				<button type="button" onClick={() => add("cron")} className="neo-btn" data-size="sm">
					<Plus size={13} />
					Schedule
				</button>
				<button type="button" onClick={() => add("webhook")} className="neo-btn" data-size="sm">
					<Plus size={13} />
					Webhook
				</button>
				<button type="button" onClick={() => add("manual")} className="neo-btn" data-size="sm">
					<Plus size={13} />
					By hand
				</button>
			</div>
		</div>
	);
}

function TriggerCard({
	trigger,
	onChange,
	onRemove,
}: {
	trigger: RoutineTrigger;
	onChange: (next: RoutineTrigger) => void;
	onRemove: () => void;
}) {
	const kind = triggerKind(trigger);
	const Icon = KIND_ICON[kind];
	const summary = describeTrigger(trigger);
	return (
		<div className="neo-card">
			<div className="flex items-center gap-2.5 px-3 py-2">
				<span className="neo-node-icon"><Icon size={13} /></span>
				<div className="min-w-0 flex-1">
					<div className={`truncate text-[13px] font-medium text-ink ${summary.mono ? "neo-mono" : ""}`}>{summary.text}</div>
					<div className="text-[11.5px] text-ink-3">{KIND_WORDS[kind]}</div>
				</div>
				<button type="button" onClick={onRemove} className="neo-btn text-ink-3 hover:!text-danger" data-variant="ghost" data-size="sm" data-icon="true" aria-label="Remove trigger">
					<Trash2 size={13} />
				</button>
			</div>
			{kind === "manual" ? null : (
				<div className="border-t border-[var(--neo-line-1)] px-3 py-3">
					{"cron" in trigger ? <CronEditor expr={trigger.cron} onChange={(c) => onChange({ cron: c })} /> : null}
					{"webhook" in trigger ? (
						<WebhookEditor
							path={trigger.webhook.path}
							secretEnv={trigger.webhook.secret_env}
							onChange={(path, secret_env) => onChange({ webhook: { path, secret_env } })}
						/>
					) : null}
					{"event" in trigger ? (
						<div className="text-[12px] text-ink-3">Event triggers are not available yet.</div>
					) : null}
				</div>
			)}
		</div>
	);
}

function CronEditor({ expr, onChange }: { expr: string; onChange: (v: string) => void }) {
	const [preview, setPreview] = useState<
		| { valid: true; nextRuns: string[] }
		| { valid: false; error: string }
		| undefined
	>(undefined);
	useEffect(() => {
		if (!expr.trim()) {
			setPreview(undefined);
			return;
		}
		const t = setTimeout(async () => {
			try {
				const r = await fetch(`/api/cron/validate?expr=${encodeURIComponent(expr)}`);
				setPreview(
					(await r.json()) as
						| { valid: true; nextRuns: string[] }
						| { valid: false; error: string },
				);
			} catch {
				/* keep previous */
			}
		}, 250);
		return () => clearTimeout(t);
	}, [expr]);
	const words = cronInWords(expr);
	return (
		<div className="space-y-2.5">
			<Field
				label="Schedule"
				help={preview?.valid === true && preview.nextRuns.length > 0
					? <>Next: {preview.nextRuns.slice(0, 2).map((iso) => new Date(iso).toLocaleString()).join(", ")}</>
					: words ?? "Five-field cron expression: minute, hour, day of month, month, day of week."}
				error={preview?.valid === false ? preview.error : undefined}
			>
				<TextInput value={expr} onChange={onChange} placeholder="0 9 * * *" mono ariaLabel="Cron expression" />
			</Field>
			<div className="flex flex-wrap gap-1">
				{PRESET_CRONS.map((p) => (
					<button
						key={p.expr}
						type="button"
						onClick={() => onChange(p.expr)}
						className="neo-chip-btn"
						data-on={p.expr === expr.trim() || undefined}
					>
						{p.label}
					</button>
				))}
			</div>
		</div>
	);
}

function WebhookEditor({
	path,
	secretEnv,
	onChange,
}: {
	path: string;
	secretEnv: string;
	onChange: (path: string, secretEnv: string) => void;
}) {
	return (
		<div className="space-y-3">
			<Field label="Path">
				<TextInput value={path} onChange={(v) => onChange(v, secretEnv)} placeholder="/hooks/my-routine" mono />
			</Field>
			<Field label="Secret" help="Name of the environment variable holding the shared secret.">
				<TextInput
					value={secretEnv}
					onChange={(v) => onChange(path, v)}
					placeholder="ROUTINE_WEBHOOK_SECRET"
					mono
				/>
			</Field>
			<p className="text-[12px] leading-relaxed text-ink-3">
				Once saved, Options → Rotate secret mints a server-side secret. Senders include{" "}
				<code className="neo-mono">X-Routine-Timestamp</code> (unix seconds) and{" "}
				<code className="neo-mono">X-Routine-Signature: sha256=HMAC(secret, "timestamp.body")</code>.
			</p>
		</div>
	);
}
