import { ImagePlus, Send, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from "react";
import type { InboxKind } from "@npi-deck/protocol";
import { NeoButton, Segmented } from "@/components/neo";
import { uploadImage, type UploadedImage } from "@/lib/uploads-api";

const KINDS: readonly InboxKind[] = ["capture", "ticket", "idea", "decision", "investigation", "email"];
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function CaptureComposer({ onCapture }: { onCapture: (title: string, body: string, kind: InboxKind) => Promise<void> }) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [kind, setKind] = useState<InboxKind>("capture");
	const [attachments, setAttachments] = useState<UploadedImage[]>([]);
	const [uploading, setUploading] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const titleInput = useRef<HTMLInputElement>(null);
	const pending = useRef(0);
	const submitting = useRef(false);
	useEffect(() => { if (!busy && notice) titleInput.current?.focus(); }, [busy, notice]);

	async function attach(files: File[]): Promise<void> {
		if (submitting.current || files.length === 0) return;
		setError(null);
		setNotice("");
		pending.current += files.length;
		setUploading(pending.current);
		for (const file of files) {
			try {
				if (!IMAGE_TYPES.has(file.type)) throw new Error("Attach a PNG, JPEG, GIF or WebP image.");
				if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} exceeds the 10 MB image limit.`);
				const saved = await uploadImage(file, file.name);
				setAttachments(previous => [...previous, saved]);
			} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
			finally { pending.current -= 1; setUploading(pending.current); }
		}
	}

	async function submit(): Promise<void> {
		if (!title.trim() || submitting.current || pending.current > 0) return;
		submitting.current = true;
		setBusy(true);
		setError(null);
		setNotice("");
		const images = attachments.map(image => `![${image.name.replace(/[\[\]\\\r\n]/g, "")}](${image.url})`).join("\n\n");
		try {
			await onCapture(title.trim(), [body, images].filter(Boolean).join("\n\n"), kind);
			setTitle(""); setBody(""); setAttachments([]);
			setNotice("Captured in the inbox.");
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { submitting.current = false; setBusy(false); }
	}

	function paste(event: ClipboardEvent): void {
		const files = Array.from(event.clipboardData.files);
		if (!files.length) return;
		event.preventDefault();
		void attach(files);
	}

	function drop(event: DragEvent): void {
		const files = Array.from(event.dataTransfer.files);
		if (!files.length) return;
		event.preventDefault();
		void attach(files);
	}

	return (
		<form className="inbox-composer" aria-label="Capture a thought" onSubmit={event => { event.preventDefault(); void submit(); }}
			onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
			onPaste={paste} onDrop={drop} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}>
			<div className="inbox-composer-draft">
				<input ref={titleInput} className="inbox-composer-title" aria-label="Capture title" placeholder="What's on your mind?" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} required />
				<textarea className="inbox-composer-notes" aria-label="Capture notes" placeholder="Add the thought, context or links. Markdown works here." value={body} onChange={event => setBody(event.target.value)} disabled={busy} rows={3} />
			{attachments.length > 0 ? <div className="inbox-composer-attachments" aria-label="Attached images">
				{attachments.map((image, index) => <div className="inbox-attachment" key={`${image.url}:${index}`}>
					<img src={image.url} alt="" /><span>{image.name}</span>
					<NeoButton size="sm" variant="ghost" aria-label={`Remove ${image.name}`} disabled={busy} onClick={() => setAttachments(previous => previous.filter((_, at) => at !== index))}><X size={13} /></NeoButton>
				</div>)}
			</div> : null}
			</div>
			<div className="inbox-composer-kind" aria-disabled={busy}>
				<Segmented label="Capture kind" value={kind} onChange={value => { if (!submitting.current) setKind(value); }} options={KINDS.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} />
			</div>
			<div className="inbox-composer-toolbar">
				<input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={event => { void attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
				<NeoButton size="sm" variant="ghost" aria-label="Attach images" title="Attach or paste PNG, JPEG, GIF or WebP images, up to 10 MB each" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} /><span className="inbox-attach-label">Images</span></NeoButton>
				<span className="inbox-composer-hint">{uploading ? `Uploading ${uploading}…` : "Ctrl / ⌘ Enter"}</span>
				<NeoButton type="submit" variant="primary" disabled={busy || uploading > 0 || !title.trim()}><Send size={14} />{busy ? "Capturing…" : "Capture"}</NeoButton>
			</div>
			<div className="inbox-composer-status" role={error ? "alert" : "status"} data-error={Boolean(error)}>{error ?? notice}</div>
		</form>
	);
}
