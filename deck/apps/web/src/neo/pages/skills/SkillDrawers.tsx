import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { parse, stringify } from "yaml";
import type { SkillDetailResponse, SkillSummary } from "@npi-deck/protocol";
import { AsyncView, Drawer, ErrorState, KeyValue, NeoButton, SectionLabel } from "@/components/neo";
import { Markdown } from "@/lib/markdown";
import { skills } from "../../client/skills";

function documentOf(frontmatter: Record<string, unknown>, body: string): string { return `---\n${stringify(frontmatter)}---\n${body}`; }
function readDocument(raw: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
	if (!match) throw new Error("Keep the frontmatter between two lines of three hyphens.");
	const value: unknown = parse(match[1]!);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Frontmatter must contain a name and description.");
	return { frontmatter: value as Record<string, unknown>, body: match[2]! };
}
export function SkillDetail({ skill, onClose, onChanged }: { skill: SkillSummary; onClose: () => void; onChanged: () => Promise<void> }) {
	const [detail, setDetail] = useState<SkillDetailResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [raw, setRaw] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState(false);
	useEffect(() => { let active = true; void skills.detail(skill.id).then((d) => { if (active) { setDetail(d); setRaw(documentOf({ ...d.frontmatter }, d.body)); } }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, [skill.id]);
	useEffect(() => { document.getElementById("neo-skill-detail-title")?.focus(); }, [skill.id]);
	async function save() {
		if (!detail) return;
		setBusy(true); setError(null);
		try {
			const next = readDocument(raw);
			for (const key of new Set([...Object.keys(next.frontmatter), ...Object.keys(detail.frontmatter)])) {
				if (key !== "description" && JSON.stringify(next.frontmatter[key]) !== JSON.stringify(detail.frontmatter[key as keyof typeof detail.frontmatter])) throw new Error("The API edits description and body only. Keep the other frontmatter unchanged.");
			}
			if (typeof next.frontmatter.description !== "string") throw new Error("Add a description in the frontmatter before saving.");
			await skills.update(skill.id, { description: next.frontmatter.description, body: next.body, revision: detail.revision });
			const saved = await skills.detail(skill.id); setDetail(saved); setRaw(documentOf({ ...saved.frontmatter }, saved.body)); setEditing(false); await onChanged();
		} catch (e) { setError(String(e)); } finally { setBusy(false); }
	}
	async function remove() { setBusy(true); try { await skills.remove(skill.id); await onChanged(); onClose(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
	return <section className="neo-skills-detail">
		<header className="neo-skills-detail-heading"><NeoButton variant="ghost" onClick={onClose}>Back to skills</NeoButton><h1 id="neo-skill-detail-title" tabIndex={-1}>{skill.name}</h1><p>{skill.providerLabel}, {skill.level} scope</p><code className="neo-skills-path">{skill.skillPath}</code></header>
		<div className="neo-skills-detail-body">
		{error ? <ErrorState error={error} /> : null}
		<AsyncView data={detail}>{(d) => <div className="neo-skills-drawer-content">{editing ? <><label className="neo-skills-field">SKILL.md<textarea className="neo-input neo-mono neo-skills-editor" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} /></label><p className="neo-dim">Edit the description and body. Other frontmatter stays unchanged.</p></> : <><Markdown relativeLinks="unavailable">{d.body}</Markdown><SectionLabel>Frontmatter</SectionLabel><KeyValue items={Object.entries(d.frontmatter).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value) }))} />{d.files.length ? <p className="neo-dim">Local file references belong to this skill's source directory. Browser file reading is unavailable.</p> : null}{!d.editable ? <p className="neo-dim">Read-only skill. Edit it in its owning source.</p> : null}</>}</div>}</AsyncView>
		</div>
		<footer className="neo-skills-detail-actions">{editing ? <><NeoButton disabled={busy} variant="primary" onClick={() => void save()}>Save changes</NeoButton><NeoButton disabled={busy} variant="ghost" onClick={() => { setEditing(false); setError(null); if (detail) setRaw(documentOf({ ...detail.frontmatter }, detail.body)); }}>Cancel</NeoButton></> : <>{skill.editable ? <><NeoButton disabled={!detail || busy} variant="ghost" onClick={() => setEditing(true)}>Edit</NeoButton><NeoButton disabled={busy} variant="danger" onClick={() => confirm ? void remove() : setConfirm(true)}>{confirm ? "Confirm delete" : "Delete"}</NeoButton>{confirm ? <NeoButton variant="ghost" onClick={() => setConfirm(false)}>Keep skill</NeoButton> : null}</> : null}<Link className="neo-btn" data-variant="primary" to={`/threads?draft=${encodeURIComponent(`Use the ${skill.name} skill at ${skill.skillPath} to `)}`}>Use in a thread</Link></>}</footer>
	</section>;
}
export function NewSkillDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (skill: SkillSummary) => Promise<void> }) {
	const [name, setName] = useState(""); const [description, setDescription] = useState("");
	const [raw, setRaw] = useState(documentOf({ name: "new-skill", description: "Describe when to use this skill." }, "\n# Instructions\n\n## When to use\n\n## Steps\n"));
	const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
	function field(key: "name" | "description", value: string) { if (key === "name") setName(value); else setDescription(value); try { const doc = readDocument(raw); setRaw(documentOf({ ...doc.frontmatter, [key]: value }, doc.body)); } catch { /* Preserve a draft with temporarily incomplete YAML. */ } }
	async function create() { setBusy(true); setError(null); try { const doc = readDocument(raw); if (doc.frontmatter.name !== name || doc.frontmatter.description !== description) throw new Error("The name and description above must match the frontmatter."); const created = await skills.create({ name: name.trim(), description: description.trim(), body: doc.body }); await onCreated(created); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
	return <Drawer open onClose={onClose} width={560} title="New skill" subtitle="Teach agents a repeatable way to do the work." footer={<><NeoButton variant="primary" disabled={busy || !name.trim() || !description.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create"}</NeoButton><NeoButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</NeoButton></>}>
		<div className="neo-skills-form">{error ? <ErrorState error={error} /> : null}<label className="neo-skills-field">Name<input autoFocus className="neo-input neo-mono" placeholder="release-notes" value={name} onChange={(e) => field("name", e.target.value)} /></label><label className="neo-skills-field">Description<input className="neo-input" placeholder="What it does and when to use it" value={description} onChange={(e) => field("description", e.target.value)} /></label><div className="neo-skills-field"><span>Scope</span><span>User</span><span className="neo-dim">Available across projects. NeoDeck creates user skills only.</span></div><label className="neo-skills-field">SKILL.md<textarea className="neo-input neo-mono neo-skills-editor" value={raw} onChange={(e) => { setRaw(e.target.value); try { const doc = readDocument(e.target.value); if (typeof doc.frontmatter.name === "string") setName(doc.frontmatter.name); if (typeof doc.frontmatter.description === "string") setDescription(doc.frontmatter.description); } catch { /* Allow incomplete frontmatter while typing. */ } }} spellCheck={false} /></label></div>
	</Drawer>;
}
