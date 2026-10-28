import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { MarkdownEdit } from "@/components/MarkdownEdit";
import { Drawer, ErrorState, NeoBadge, NeoButton, NeoSelect, SectionLabel } from "@/components/neo";
import { projectLabel } from "@/lib/kanban-project";
import { board, type BoardCard, type BoardColumn } from "../../client/board";

export function NewCardDrawer({ columns, projects, initialProject, onClose, onCreated }: { columns: BoardColumn[]; projects: string[]; initialProject: string; onClose: () => void; onCreated: (card: BoardCard) => Promise<void> }) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [cwd, setCwd] = useState(initialProject);
	const [columnId, setColumnId] = useState(columns.find((column) => column.isDefault)?.id ?? columns[0]?.id ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function create(e: FormEvent) {
		e.preventDefault(); if (!title.trim() || busy) return;
		setBusy(true); setError(null);
		try { await onCreated(await board.create({ title: title.trim(), body, columnId, cwd: cwd || undefined })); }
		catch (err) { setError(`Could not create the card. ${String(err)}`); }
		finally { setBusy(false); }
	}
	return <Drawer open width={560} onClose={onClose} title="Add a card directly" subtitle="Usually work arrives through Inbox. This bypasses intake without starting an assignment." footer={<><NeoButton variant="ghost" onClick={onClose}>Cancel</NeoButton><NeoButton variant="primary" type="submit" form="neo-board-create" disabled={busy || !title.trim() || !columnId}>{busy ? "Creating…" : "Create card"}</NeoButton></>}>
		<form id="neo-board-create" className="neo-board-form" onSubmit={(e) => void create(e)}>
			{error && <ErrorState error={error} />}
			<label>Title<input className="neo-input" aria-label="New card title" placeholder="What needs to happen?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required /></label>
			<div className="neo-board-form-routing"><label>Project<NeoSelect aria-label="New card project" value={cwd} onChange={(e) => setCwd(e.target.value)}><option value="">Unassigned</option>{projects.map((project) => <option key={project} value={project}>{projectLabel(project)}</option>)}</NeoSelect></label><label>Column<NeoSelect aria-label="New card column" value={columnId} onChange={(e) => setColumnId(e.target.value)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</NeoSelect></label></div>
			<section><SectionLabel>Body</SectionLabel><div className="neo-board-markdown-editor"><MarkdownEdit value={body} onChange={setBody} onDraftChange={setBody} autoEdit autoFocus={false} placeholder="Instructions, acceptance criteria, links…" /></div></section>
		</form>
	</Drawer>;
}

export function ColumnsDrawer({ columns, onClose, onChanged }: { columns: BoardColumn[]; onClose: () => void; onChanged: () => Promise<void> }) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fallback = columns.find((column) => column.isDefault);
	async function act(action: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true); setError(null);
		try { await action(); await onChanged(); }
		catch (err) { setError(`Could not update the columns. ${String(err)}`); }
		finally { setBusy(false); }
	}
	function reorder(index: number, offset: number) {
		const ids = columns.map((column) => column.id);
		const other = index + offset;
		if (other < 0 || other >= ids.length) return;
		[ids[index], ids[other]] = [ids[other]!, ids[index]!];
		void act(() => board.reorderColumns(ids));
	}
	return <Drawer open width={420} title="Columns" subtitle="States of the work, in the order it moves." onClose={onClose} footer={<NeoButton variant="primary" onClick={onClose}>Done</NeoButton>}>
		<div className="neo-board-column-editor">{error && <ErrorState error={error} />}<ol className="neo-board-state-list">{columns.map((column, index) => <li key={column.id}>
			<div className="neo-board-state-row"><input key={`${column.id}-${column.name}`} className="neo-input" aria-label={`Rename ${column.name}`} defaultValue={column.name} disabled={busy} onBlur={(e) => { const value = e.target.value.trim(); if (value && value !== column.name) void act(() => board.updateColumn(column.id, { name: value })); else e.target.value = column.name; }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /><label className="neo-board-color" title={`Colour for ${column.name}`} style={{ background: column.color }}><input type="color" aria-label={`Colour for ${column.name}`} value={column.color.startsWith("#") ? column.color : "#6c6c74"} disabled={busy} onChange={(e) => void act(() => board.updateColumn(column.id, { color: e.target.value }))} /></label></div>
			<div className="neo-board-state-tools">{column.isDefault ? <NeoBadge>default</NeoBadge> : <span>Cards move to {fallback?.name ?? "the default"} when deleted</span>}<div className="neo-board-actions"><NeoButton size="sm" variant="ghost" icon aria-label={`Move ${column.name} up`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={13} /></NeoButton><NeoButton size="sm" variant="ghost" icon aria-label={`Move ${column.name} down`} disabled={busy || index === columns.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={13} /></NeoButton><NeoButton size="sm" variant="ghost" icon aria-label={`Delete ${column.name}`} disabled={busy || column.isDefault} onClick={() => void act(() => board.removeColumn(column.id))}><Trash2 size={13} /></NeoButton></div></div>
		</li>)}</ol><form className="neo-board-add-column" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void act(async () => { await board.createColumn(name.trim()); setName(""); }); }}><SectionLabel>Add column</SectionLabel><div className="neo-board-actions"><input className="neo-input" aria-label="New column name" placeholder="Column name" value={name} onChange={(e) => setName(e.target.value)} /><NeoButton type="submit" disabled={busy || !name.trim()}><Plus size={13} />Add</NeoButton></div></form></div>
	</Drawer>;
}
