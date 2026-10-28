import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Save } from "lucide-react";
import { validateRoutineGraph, type GraphNodeType, type GraphRunRecord, type Routine, type RoutineGraph, type RoutineSpec, type ValidationError } from "@npi-deck/protocol";
import { RoutineRequestError, routinesApi } from "@/lib/routines-api";
import { LegacyRoutineBuilder } from "./LegacyRoutineBuilder";
import { RoutineCanvas } from "./canvas/RoutineCanvas";
import { Checkbox, Field, TextArea, TextInput } from "./form-primitives";

export interface RoutineBuilderHandle {
	save(): Promise<void>;
	updateMetadata(value: { name?: string; description?: string }): void;
	/** Existing V0/V1 rows only. Native graphs never compile through RoutineSpec. */
	updateSpec(spec: RoutineSpec): void;
}
export interface RoutineBuilderState {
	name: string;
	description?: string;
	spec?: RoutineSpec;
	graph?: RoutineGraph;
	dirty: boolean;
	canSave: boolean;
}
export interface RoutineBuilderProps {
	routine: Routine | undefined;
	onSaved: (saved: Routine) => void;
	onError: (message: string) => void;
	embedded?: boolean;
	view?: "canvas" | "source";
	editorRef?: Ref<RoutineBuilderHandle>;
	onStateChange?: (state: RoutineBuilderState) => void;
	trace?: GraphRunRecord | null;
	inspectorHidden?: boolean;
	onInspect?: () => void;
}

/** Discriminate persisted format before mounting an editor. New routines are native. */
export function RoutineBuilder(props: RoutineBuilderProps) {
	if (props.routine?.specVersion === 0 || props.routine?.specVersion === 1) return <LegacyRoutineBuilder {...props} />;
	return <NativeRoutineBuilder key={props.routine?.id ?? "new"} {...props} />;
}

function NativeRoutineBuilder({ routine, onSaved, onError, embedded, view, editorRef, onStateChange, trace, inspectorHidden, onInspect }: RoutineBuilderProps) {
	const [graph, setGraph] = useState<RoutineGraph>(() => routine?.graph ?? { version: 2, nodes: [], edges: [] });
	const [name, setName] = useState(routine?.name ?? "");
	const [description, setDescription] = useState(routine?.description ?? "");
	const [enabled, setEnabled] = useState(routine?.enabled ?? false);
	const [catalogue, setCatalogue] = useState<GraphNodeType[]>([]);
	const [catalogueState, setCatalogueState] = useState<"loading" | "ready" | "error">("loading");
	const [catalogueError, setCatalogueError] = useState<string>();
	const [loadSequence, setLoadSequence] = useState(0);
	const [busy, setBusy] = useState(false);
	const [serverErrors, setServerErrors] = useState<ValidationError[]>([]);
	const [source, setSource] = useState(false);
	const [sourceBuffer, setSourceBuffer] = useState(() => JSON.stringify(graph, null, 2));
	const [sourceDirty, setSourceDirty] = useState(false);
	const [sourceError, setSourceError] = useState<string>();
	const [configInvalid, setConfigInvalid] = useState(false);
	const persisted = useRef({ graph, name, description, enabled });
	const hasMissingGraph = routine?.specVersion === 2 && !routine.graph;
	const readOnly = !!trace || hasMissingGraph;
	const displayGraph = trace?.graph ?? graph;
	const sourceView = view === undefined ? source : view === "source";
	const validation = useMemo(() => validateRoutineGraph(graph, catalogue), [graph, catalogue]);
	const localErrors = catalogueState === "ready" ? validation.errors ?? [] : [];
	const errors = serverErrors.length ? serverErrors : localErrors;
	const dirty = graph !== persisted.current.graph || name !== persisted.current.name || description !== persisted.current.description || enabled !== persisted.current.enabled || sourceDirty;
	const canSave = !readOnly && !busy && catalogueState === "ready" && name.trim().length > 0 && validation.valid && !configInvalid && !sourceDirty;

	useEffect(() => {
		let active = true; setCatalogueState("loading"); setCatalogueError(undefined);
		void routinesApi.nodeTypes().then(result => { if (!active) return; setCatalogue(result.nodeTypes); setCatalogueState("ready"); }).catch(error => { if (!active) return; setCatalogueError(String(error)); setCatalogueState("error"); });
		return () => { active = false; };
	}, [loadSequence]);
	useEffect(() => { if (routine) setEnabled(routine.enabled); }, [routine?.enabled]);
	useEffect(() => { if (!sourceDirty) setSourceBuffer(JSON.stringify(graph, null, 2)); }, [graph, sourceDirty]);

	const updateGraph = useCallback((next: RoutineGraph) => { setGraph(next); setServerErrors([]); setSourceError(undefined); }, []);
	function updateMetadata(value: { name?: string; description?: string }) {
		if (readOnly) return;
		if (value.name !== undefined) setName(value.name);
		if (value.description !== undefined) setDescription(value.description);
	}
	async function applySource(): Promise<void> {
		if (readOnly) return;
		setBusy(true);
		try {
			const candidate: unknown = JSON.parse(sourceBuffer);
			const local = validateRoutineGraph(candidate, catalogue);
			if (!local.valid) { setServerErrors(local.errors ?? []); setSourceError("The graph source is invalid. Fix the paths shown below."); return; }
			const next = candidate as RoutineGraph;
			const result = await routinesApi.validateGraph(next);
			if (!result.valid) { setServerErrors(result.errors ?? []); setSourceError("The server rejected this graph source. Fix the paths shown below."); return; }
			updateGraph(next); setSourceDirty(false);
		} catch (error) { setSourceError(String(error)); }
		finally { setBusy(false); }
	}
	async function save(): Promise<void> {
		if (readOnly || busy) return;
		if (!name.trim()) { onError("Give the routine a name before saving."); return; }
		if (sourceDirty || configInvalid) { onError("Apply or correct the edited graph fields before saving."); return; }
		if (catalogueState !== "ready") { onError("The node library must load before saving."); return; }
		setBusy(true);
		try {
			const result = await routinesApi.validateGraph(graph);
			if (!result.valid) { const errors = result.errors ?? []; setServerErrors(errors); onError(errors.map(error => `${error.path || "/"}: ${error.message}`).join("; ") || "The server rejected this graph."); return; }
			const body = { name, description, enabled, graph };
			const saved = routine ? await routinesApi.update(routine.id, body) : await routinesApi.create(body);
			persisted.current = { graph, name, description, enabled }; setServerErrors([]); onSaved(saved);
		} catch (error) {
			if (error instanceof RoutineRequestError && error.errors.length) setServerErrors(error.errors);
			onError(String(error));
		} finally { setBusy(false); }
	}
	useImperativeHandle(editorRef, () => ({ save, updateMetadata, updateSpec: () => onError("This is a native graph. Change its metadata or edit the graph directly.") }));
	useEffect(() => { onStateChange?.({ name, description, graph, dirty, canSave }); }, [name, description, graph, dirty, canSave, onStateChange]);

	return <div className="flex h-full min-h-0 flex-1 flex-col">
		{!embedded ? <div className="mb-3 shrink-0 space-y-3">
			<div className="flex items-end gap-3"><div className="min-w-0 flex-1"><Field label="Routine name"><TextInput value={name} onChange={setName} ariaLabel="Routine name" placeholder="Name this routine" /></Field></div><button type="button" className="neo-btn" data-size="sm" data-variant="primary" disabled={!canSave} onClick={() => void save()}><Save size={13} />{busy ? "Saving…" : "Save routine"}</button></div>
			<details><summary className="cursor-pointer text-[12px] text-ink-2">Routine details</summary><fieldset disabled={readOnly} className="mt-3 space-y-3"><Field label="Description" optional><TextArea value={description} mono={false} onChange={setDescription} ariaLabel="Routine description" /></Field><Checkbox checked={enabled} onChange={setEnabled}>Enabled</Checkbox><p className="text-[12px] text-ink-3">Manual runs activate only sources configured for manual events. Inbox sources run when a card enters the inbox.</p></fieldset></details>
			<div className="flex gap-1"><button type="button" className="neo-btn" data-size="sm" data-variant={!sourceView ? "secondary" : "ghost"} onClick={() => setSource(false)}>Canvas</button><button type="button" className="neo-btn" data-size="sm" data-variant={sourceView ? "secondary" : "ghost"} onClick={() => setSource(true)}>View graph source</button></div>
		</div> : null}
		{catalogueState === "loading" ? <p role="status" className="shrink-0 px-3 py-2 text-[12px] text-ink-3">Loading registered nodes…</p> : catalogueState === "error" ? <div role="alert" className="shrink-0 px-3 py-2 text-[12px] text-danger">Could not load registered nodes. {catalogueError} <button type="button" className="neo-btn" data-size="sm" data-variant="ghost" onClick={() => setLoadSequence(value => value + 1)}>Retry</button></div> : null}
		{hasMissingGraph ? <p role="alert" className="px-3 py-2 text-[12px] text-danger">This native routine has no graph definition. Reload it from the server before editing.</p> : null}
		{sourceDirty && !sourceView ? <p role="alert" className="shrink-0 px-3 py-2 text-[12px] text-warning">Graph source has unapplied edits. Open View graph source to apply or discard them before saving.</p> : null}
		{sourceView ? <div className="flex min-h-0 flex-1 flex-col gap-2">
			<p className="text-[12px] text-ink-3">{trace ? "Native graph snapshot executed in this run. Read-only." : "Advanced native graph JSON. Applying it validates the same graph used by the canvas."}</p>
			<textarea aria-label={trace ? "Historical graph JSON" : "Native graph JSON"} className="neo-input min-h-0 flex-1 resize-none font-mono text-[12px]" spellCheck={false} readOnly={readOnly} value={trace ? JSON.stringify(displayGraph, null, 2) : sourceBuffer} onChange={event => { setSourceBuffer(event.target.value); setSourceDirty(true); setSourceError(undefined); }} />
			{!readOnly ? <div className="flex gap-2"><button type="button" className="neo-btn" data-size="sm" data-variant="secondary" disabled={!sourceDirty || busy || catalogueState !== "ready"} onClick={() => void applySource()}>Validate and apply JSON</button><button type="button" className="neo-btn" data-size="sm" data-variant="ghost" disabled={!sourceDirty || busy} onClick={() => { setSourceDirty(false); setSourceBuffer(JSON.stringify(graph, null, 2)); setSourceError(undefined); setServerErrors([]); }}>Discard source edits</button></div> : null}
			{sourceError ? <p role="alert" className="text-[12px] text-danger">{sourceError}</p> : null}
		</div> : <RoutineCanvas graph={displayGraph} catalogue={catalogue} onChange={next => { if (!readOnly) updateGraph(next); }} errors={trace ? [] : errors} trace={trace} readOnly={readOnly || catalogueState !== "ready"} onConfigInvalidChange={setConfigInvalid} inspectorHidden={inspectorHidden} onInspect={onInspect} />}
		{!trace && errors.length ? <details className="mt-2 shrink-0 text-[12px]" open={serverErrors.length > 0}><summary className="cursor-pointer text-danger">{errors.length} {errors.length === 1 ? "problem" : "problems"} to fix before saving</summary><ul role="alert" className="max-h-[160px] space-y-1 overflow-auto py-2 text-danger">{errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path || "/"}</code> {error.message}</li>)}</ul></details> : null}
	</div>;
}
