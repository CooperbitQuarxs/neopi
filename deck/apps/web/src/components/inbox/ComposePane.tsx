/**
 * The compose slip: a title, an optional body, a kind. It sits at the top
 * of the inbox list and collapses back once captured.
 *
 * The body is read from a synchronous draft ref at submit time (via
 * `MarkdownEdit.onDraftChange`) so a click on Capture that never blurs the
 * editor still saves what was typed; `onChange` keeps commit semantics and
 * Escape in the editor restores the committed draft.
 */
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import type { InboxItem, InboxKind } from "@npi-deck/protocol";
import { MarkdownEdit } from "../MarkdownEdit";
import { inboxApi } from "../../lib/inbox-api";

export const KIND_ORDER: ReadonlyArray<InboxKind> = [
	"capture",
	"idea",
	"investigation",
	"decision",
	"ticket",
	"email",
];

/** Plural, for filters and counts. */
export const KIND_LABEL: Record<InboxKind, string> = {
	email: "emails",
	ticket: "tickets",
	idea: "ideas",
	decision: "decisions",
	investigation: "investigations",
	capture: "captures",
};

/** Singular, for the label on one slip. */
export const KIND_WORD: Record<InboxKind, string> = {
	email: "Email",
	ticket: "Ticket",
	idea: "Idea",
	decision: "Decision",
	investigation: "Investigation",
	capture: "Capture",
};

export function ComposePane({
	onClose,
	onCreated,
	initialKind = "capture",
}: {
	onClose: () => void;
	onCreated: (item: InboxItem) => void;
	initialKind?: InboxKind;
}) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	// Capture may activate without blurring the markdown editor first.
	const bodyDraft = useRef("");
	const [kind, setKind] = useState<InboxKind>(initialKind);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | undefined>();

	async function submit(): Promise<void> {
		const t = title.trim();
		if (!t) return;
		setBusy(true);
		setErr(undefined);
		try {
			const created = await inboxApi.create({ kind, title: t, body: bodyDraft.current });
			onCreated(created);
		} catch (e) {
			setErr(String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="neo-slip-compose" data-testid="inbox-compose">
			<div className="px-4 pt-4">
				<input
					autoFocus
					data-title="true"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onKeyDown={(e) => {
						if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
						if (e.key === "Escape") onClose();
					}}
					placeholder="What's on your mind?"
					aria-label="Title"
				/>
			</div>
			<div className="px-4 pb-2 pt-2">
				<MarkdownEdit
					value={body}
					onChange={setBody}
					onDraftChange={(next) => { bodyDraft.current = next; }}
					autoEdit
					autoFocus={false}
					keepEmptyEditing
					placeholder="Details, context, links… (markdown). Leave it empty if the title says it all."
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2 border-t border-[var(--neo-line-1)] px-4 py-2.5">
				<span className="text-[12px] text-ink-3">Label it</span>
				<select
					value={kind}
					onChange={(e) => setKind(e.target.value as InboxKind)}
					className="neo-input"
					data-size="sm"
					aria-label="Kind"
				>
					{KIND_ORDER.map((k) => (
						<option key={k} value={k}>
							{KIND_WORD[k]}
						</option>
					))}
				</select>
				<span className="hidden text-[12px] text-ink-4 sm:inline">or let the office label it later</span>
				<div className="ml-auto flex items-center gap-1.5">
					<span className="mr-1 hidden items-center gap-1 text-[11.5px] text-ink-4 md:inline-flex">
						<kbd className="neo-kbd">⌘</kbd><kbd className="neo-kbd">↵</kbd>
					</span>
					<button type="button" onClick={onClose} className="neo-btn" data-variant="ghost" data-size="sm">
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={busy || !title.trim()}
						className="neo-btn"
						data-variant="primary"
						data-size="sm"
						aria-label="Capture"
					>
						<Check size={13} />
						Capture
					</button>
				</div>
			</div>
			{err ? (
				<div className="border-t border-[var(--neo-line-1)] bg-[var(--neo-bad-soft)] px-4 py-1.5 text-[12px] text-danger" role="alert">
					{err}
				</div>
			) : null}
		</div>
	);
}
