import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { uploadImage } from "@/lib/uploads-api";
import { cn } from "@/lib/utils";

interface Props {
	value: string;
	onChange: (next: string) => void;
	/** Observes the live draft, including image uploads and cancelled edits, before commit. */
	onDraftChange?: (next: string) => void;
	/** Fires when the user commits the edit (blur or ctrl/cmd+enter). */
	onCommit?: (next: string) => void;
	placeholder?: string;
	className?: string;
	textareaClassName?: string;
	/** Force edit mode on mount (used when value is empty so user knows it's editable). */
	autoEdit?: boolean;
	/** Focus the initial textarea. Explicitly reopening the editor still focuses it. */
	autoFocus?: boolean;
	/** Keep an empty textarea available after commit instead of showing a placeholder. */
	keepEmptyEditing?: boolean;
}

/**
 * Notebook-style markdown surface. Reads as rendered markdown by default; click
 * (or tab into) the body to swap to a textarea for editing. Tab away or hit
 * ⌘/Ctrl+Enter to commit, Esc to cancel and restore.
 *
 * Images: while editing, pasting (Ctrl/Cmd+V) or dropping an image file into
 * the textarea uploads it to `/api/uploads/image` and splices `![name](url)`
 * at the caret position. Images written by agents (markdown with absolute or
 * `/uploads/...` URLs) render inline through the shared Markdown component.
 */
export function MarkdownEdit({
	value,
	onChange,
	onDraftChange,
	onCommit,
	placeholder = "Click to add notes…",
	className,
	textareaClassName,
	autoEdit,
	autoFocus = true,
	keepEmptyEditing = false,
}: Props) {
	const [editing, setEditing] = useState(Boolean(autoEdit) || !value);
	const [draft, setDraft] = useState(value);
	const [uploadError, setUploadError] = useState<string | undefined>();
	const [uploadingCount, setUploadingCount] = useState(0);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const focusOnEdit = useRef(autoFocus);
	// Track the latest draft via ref so async upload completions can splice
	// against the current text rather than the value captured at paste-time.
	const draftRef = useRef(value);
	useEffect(() => {
		draftRef.current = draft;
	}, [draft]);

	// Sync down when the canonical value changes from outside (resave, swap item).
	useEffect(() => {
		setDraft(value);
		draftRef.current = value;
	}, [value]);

	useEffect(() => {
		if (!editing) return;
		const ta = taRef.current;
		if (!ta) return;
		if (focusOnEdit.current) {
			ta.focus();
			// Move caret to end so a new note starts in flow.
			ta.setSelectionRange(ta.value.length, ta.value.length);
		}
		ta.style.height = "auto";
		ta.style.height = `${Math.max(ta.scrollHeight, 240)}px`;
	}, [editing]);

	function updateDraft(next: string): void {
		draftRef.current = next;
		setDraft(next);
		onDraftChange?.(next);
	}

	function startEditing(): void {
		focusOnEdit.current = true;
		setEditing(true);
	}

	function commit(): void {
		if (draft !== value) {
			onChange(draft);
			onCommit?.(draft);
		}
		setEditing(keepEmptyEditing && !draft);
	}

	function cancel(): void {
		updateDraft(value);
		setEditing(false);
	}

	/**
	 * Replace the current selection (or insert at caret) with `inserted`, then
	 * leave the caret at the end of the inserted text. Operates against the
	 * live draft via `draftRef` so multiple concurrent paste promises don't
	 * clobber each other.
	 */
	function spliceAtCaret(inserted: string): void {
		const ta = taRef.current;
		const current = draftRef.current;
		if (!ta) {
			// No textarea (race after edit closed); append to current draft.
			const next = current + inserted;
			updateDraft(next);
			return;
		}
		const start = ta.selectionStart ?? current.length;
		const end = ta.selectionEnd ?? current.length;
		const next = current.slice(0, start) + inserted + current.slice(end);
		updateDraft(next);
		// Restore caret synchronously after React re-renders the textarea.
		const caret = start + inserted.length;
		requestAnimationFrame(() => {
			if (taRef.current === ta) {
				ta.setSelectionRange(caret, caret);
				ta.style.height = "auto";
				ta.style.height = `${Math.max(ta.scrollHeight, 240)}px`;
			}
		});
	}

	/**
	 * Upload a single image file, splicing a placeholder at the caret while
	 * the request is in flight and rewriting it to the real markdown image
	 * link on success (or pulling the placeholder on failure).
	 *
	 * Each placeholder gets a unique token so concurrent pastes don't collide.
	 */
	async function uploadAndInsert(file: File | Blob, name?: string): Promise<void> {
		const token = `omp-upload-${Math.random().toString(36).slice(2, 10)}`;
		const placeholder = `![uploading…](${token})`;
		spliceAtCaret(placeholder);
		setUploadingCount((c) => c + 1);
		setUploadError(undefined);
		try {
			const saved = await uploadImage(file, name);
			const alt = saved.name.replace(/[\[\]]/g, "");
			const replacement = `![${alt}](${saved.url})`;
			const next = draftRef.current.replace(placeholder, replacement);
			updateDraft(next);
		} catch (err) {
			// Pull the placeholder so the user isn't left with a broken link.
			const next = draftRef.current.replace(placeholder, "");
			updateDraft(next);
			setUploadError(String(err instanceof Error ? err.message : err));
		} finally {
			setUploadingCount((c) => Math.max(0, c - 1));
		}
	}

	/**
	 * Extract image files from a DataTransfer (paste or drop). The Files list
	 * is preferred because it carries names; the items list catches screenshot
	 * pastes that don't expose a File.
	 */
	function imagesFromDataTransfer(dt: DataTransfer | null): { blob: Blob; name?: string }[] {
		if (!dt) return [];
		const out: { blob: Blob; name?: string }[] = [];
		// Files first.
		if (dt.files && dt.files.length > 0) {
			for (const f of Array.from(dt.files)) {
				if (f.type.startsWith("image/")) out.push({ blob: f, name: f.name });
			}
		}
		// Fall back to items for clipboard screenshots.
		if (out.length === 0 && dt.items) {
			for (const it of Array.from(dt.items)) {
				if (it.kind === "file" && it.type.startsWith("image/")) {
					const f = it.getAsFile();
					if (f) out.push({ blob: f, name: f.name });
				}
			}
		}
		return out;
	}

	if (editing) {
		return (
			<div className="relative">
				<textarea
					ref={taRef}
					value={draft}
					onChange={(e) => {
						updateDraft(e.target.value);
						const ta = e.currentTarget;
						ta.style.height = "auto";
						ta.style.height = `${Math.max(ta.scrollHeight, 240)}px`;
					}}
					onBlur={() => {
						// Suppress commit-on-blur while an upload is in flight; the
						// async splice would otherwise resolve into a stale value.
						if (uploadingCount > 0) return;
						commit();
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							cancel();
						}
						if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
					onPaste={(e) => {
						const images = imagesFromDataTransfer(e.clipboardData);
						if (images.length === 0) return;
						e.preventDefault();
						for (const { blob, name } of images) void uploadAndInsert(blob, name);
					}}
					onDragOver={(e) => {
						if (e.dataTransfer?.types?.includes("Files")) {
							e.preventDefault();
						}
					}}
					onDrop={(e) => {
						const images = imagesFromDataTransfer(e.dataTransfer);
						if (images.length === 0) return;
						e.preventDefault();
						for (const { blob, name } of images) void uploadAndInsert(blob, name);
					}}
					placeholder={placeholder}
					className={cn(
						"w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-4 focus:outline-none",
						"min-h-[14rem]",
						textareaClassName,
					)}
				/>
				{uploadingCount > 0 ? (
					<div className="pointer-events-none absolute right-2 top-2 rounded bg-paper-3 px-2 py-0.5 font-mono text-2xs text-ink-3">
						uploading {uploadingCount} image{uploadingCount === 1 ? "" : "s"}…
					</div>
				) : null}
				{uploadError ? (
					<div className="mt-1 font-mono text-2xs text-danger" role="alert">
						upload failed: {uploadError}
					</div>
				) : null}
				<div className="mt-1 font-mono text-2xs text-ink-4">
					paste or drop an image to embed it · ⌘+enter to save · esc to cancel
				</div>
			</div>
		);
	}

	if (!value) {
		return (
			<button
				type="button"
				onClick={startEditing}
				className={cn(
					"block w-full cursor-text text-left font-mono text-2xs text-ink-4 hover:text-ink-3",
					className,
				)}
			>
				{placeholder}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={startEditing}
			title="Click to edit"
			className={cn("group block w-full cursor-text text-left", className)}
		>
			<Markdown className="text-[14px]">{value}</Markdown>
			<div className="mt-1 font-mono text-2xs text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
				click to edit · paste images while editing · ⌘+enter to save · esc to cancel
			</div>
		</button>
	);
}
