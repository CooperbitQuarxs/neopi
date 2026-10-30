import { Check, Copy, Network } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { KbFileResponse } from "@npi-deck/protocol";
import { Link, useLocation } from "react-router-dom";
import { KeyValue, NeoBadge, NeoButton, NeoLinkButton, Notice, formatRelativeTime } from "@/components/neo";
import { Markdown } from "@/lib/markdown";
import { noteDir, noteTitle } from "./NoteList";

export function fileTitle(file: KbFileResponse): string {
	const title = file.frontmatter.title ?? file.frontmatter.name;
	return typeof title === "string" && title.trim() ? title : noteTitle(file.path);
}
function valueText(value: unknown): string {
	if (value === null || value === undefined) return "Not set";
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Keep the shared Markdown renderer while giving its sanitizer safe wiki URLs. */
function wikiBody(body: string): string {
	return body.replace(/\]\(kb-(link|unresolved):([^\n)]*)\)/g, (_match, kind: string, destination: string) => {
		const [rawPath, query = ""] = destination.split("?");
		let path = rawPath ?? "";
		try { path = decodeURIComponent(path); } catch { /* A malformed escape stays visible as the original target. */ }
		const params = new URLSearchParams({ [kind === "link" ? "note" : "unresolved"]: path });
		const anchor = new URLSearchParams(query).get("anchor");
		return `](/knowledge?${params}${anchor ? `#${encodeURIComponent(anchor)}` : ""}${kind === "unresolved" ? ' "No note with this name yet"' : ""})`;
	});
}

export function NoteReader({ file, onOpen, onAsk, onUnresolved }: { file: KbFileResponse; onOpen: (path: string, anchor?: string) => void; onAsk: () => void; onUnresolved: (target: string) => void }) {
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState<string | null>(null);
	const body = useMemo(() => wikiBody(file.bodyForRender), [file.bodyForRender]);
	const [source, setSource] = useState(false);
	const proseRef = useRef<HTMLDivElement>(null);
	const { hash } = useLocation();
	useEffect(() => {
		if (!hash || source) return;
		let anchor: string;
		try { anchor = decodeURIComponent(hash.slice(1)).toLowerCase(); } catch { return; }
		const headings = proseRef.current?.querySelectorAll("h1,h2,h3,h4,h5,h6");
		const heading = [...(headings ?? [])].find(element => {
			const text = element.textContent?.trim().toLowerCase() ?? "";
			return element.id === anchor || text === anchor || text.replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-") === anchor;
		});
		heading?.scrollIntoView({ block: "start" });
	}, [file.path, hash, source]);
	const fields = Object.entries(file.frontmatter).filter(([key]) => !["_raw", "title", "name"].includes(key));
	const skill = /(^|\/)SKILL\.md$/i.test(file.path);
	const skillName = file.path.split("/").at(-2) ?? fileTitle(file);
	async function copy(): Promise<void> {
		try { await navigator.clipboard.writeText(file.path); setCopied(true); setCopyError(null); }
		catch { setCopyError("Could not copy the path. Select the path above and copy it."); }
	}
	function follow(event: MouseEvent<HTMLDivElement>): void {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const element = event.target instanceof Element ? event.target.closest("a") : null;
		const href = element?.getAttribute("href");
		if (!href?.startsWith("/knowledge?")) return;
		const target = new URL(href, window.location.origin);
		const note = target.searchParams.get("note");
		const missing = target.searchParams.get("unresolved");
		if (note) { event.preventDefault(); onOpen(note, target.hash); }
		if (missing) { event.preventDefault(); onUnresolved(missing); }
	}
	return <>
		<header className="neo-knowledge-note-head">
			<div className="neo-knowledge-note-heading"><h2>{fileTitle(file)}</h2><span className="neo-mono neo-knowledge-path">{file.path}</span></div>
			<div className="neo-knowledge-note-actions">
				<NeoButton variant="ghost" size="sm" on={source} aria-pressed={source} onClick={() => setSource(value => !value)}>{source ? "Read note" : "View source"}</NeoButton>
				<NeoButton variant="ghost" size="sm" onClick={onAsk}>Request an edit</NeoButton>
				<NeoButton variant="ghost" size="sm" icon onClick={() => void copy()} title={copied ? "Path copied" : "Copy path"} aria-label={copied ? "Path copied" : "Copy path"}>{copied ? <Check size={13} /> : <Copy size={13} />}</NeoButton>
				<NeoLinkButton variant="ghost" size="sm" icon to={`/knowledge?view=map&note=${encodeURIComponent(file.path)}`} title="Open full knowledge map" aria-label="Open full knowledge map"><Network size={14} /></NeoLinkButton>
			</div>
		</header>
		<div className="neo-knowledge-reader-scroll">
			<div className="neo-knowledge-note-meta"><NeoBadge mono>{noteDir(file.path) || "(root)"}</NeoBadge><span title={new Date(file.mtime).toLocaleString()}>Updated {formatRelativeTime(file.mtime)}</span>{skill ? <Link to={`/skills?skill=${encodeURIComponent(skillName)}`}><NeoBadge>This is a skill</NeoBadge></Link> : null}</div>
			{copyError ? <Notice tone="warn">{copyError}</Notice> : null}
			{file.frontmatterError ? <Notice tone="warn">Could not read this note's frontmatter. {file.frontmatterError}</Notice> : null}
			{fields.length ? <div className="neo-knowledge-frontmatter"><KeyValue items={fields.map(([key, value]) => ({ key, value: key === "tags" && Array.isArray(value) ? <span className="neo-knowledge-tags">{value.map((tag, index) => <NeoBadge key={index}>{valueText(tag)}</NeoBadge>)}</span> : valueText(value) }))} /></div> : null}
			{source ? <pre className="neo-knowledge-source">{file.rawContent}</pre> : <div ref={proseRef} className="neo-knowledge-prose" onClick={follow}><Markdown>{body}</Markdown></div>}
		</div>
	</>;
}
