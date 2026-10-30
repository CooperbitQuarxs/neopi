import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { isGraphValue, type GraphNode, type GraphNodeType, type GraphObject, type GraphValue, type RoutineGraph, type ValidationError } from "@npi-deck/protocol";
import { Field, Select } from "../form-primitives";
import { configFormSchema, graphObject, resolveConfigSchema, schemaChoices, schemaDefault, schemaForValue, schemaProperties, valueKind } from "./graph-config";

type ReportIssue = (path: string, message?: string) => void;
interface ValueProps {
	value: GraphValue;
	schema: GraphObject;
	path: string;
	onChange: (value: GraphValue) => void;
	reportIssue: ReportIssue;
	binding?: { graph: RoutineGraph; node: GraphNode; catalogue: readonly GraphNodeType[] };
	rootSchema?: GraphObject;
}
const TYPE_OPTIONS = ["string", "number", "boolean", "null", "array", "object"].map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
const inputClass = "neo-input w-full";
function label(key: string): string { return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, text => text.toUpperCase()); }
function pointer(key: string): string { return key.replaceAll("~", "~0").replaceAll("/", "~1"); }

export function GraphConfigForm({ node, graph, catalogue, definition, onChange, errors = [], onIssuesChange }: {
	node: GraphNode; graph: RoutineGraph; catalogue: readonly GraphNodeType[]; definition?: GraphNodeType;
	onChange: (config: GraphObject) => void; errors?: ValidationError[]; onIssuesChange: (invalid: boolean) => void;
}) {
	const [issues, setIssues] = useState<Record<string, string>>({});
	const reportIssue = useCallback<ReportIssue>((path, message) => setIssues(previous => {
		if (previous[path] === message) return previous;
		const next = { ...previous }; if (message) next[path] = message; else delete next[path]; return next;
	}), []);
	useEffect(() => { onIssuesChange(Object.keys(issues).length > 0); }, [issues, onIssuesChange]);
	useEffect(() => () => onIssuesChange(false), [onIssuesChange]);
	const schema = definition ? configFormSchema(definition) : { type: "object" };
	const bindings = definition && ["action.create-card", "action.send-message", "action.file-issue"].includes(definition.type) ? { graph, node, catalogue } : undefined;
	return <div className="space-y-4">
		{!definition ? <p className="text-[12px] text-warning">This node registration is unavailable. Its stored configuration is preserved.</p> : null}
		<ObjectFields value={node.config} schema={schema} rootSchema={schema} path="/config" onChange={value => onChange(graphObject(value) ?? {})} reportIssue={reportIssue} binding={bindings} iteration={node.type === "iteration.each"} />
		{errors.length ? <ul role="alert" className="space-y-1 text-[12px] text-danger">{errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code> {error.message}</li>)}</ul> : null}
		{Object.entries(issues).map(([path, message]) => <p role="alert" key={path} className="text-[12px] text-danger"><code>{path}</code> {message}</p>)}
	</div>;
}


function ValueEditor(props: ValueProps) {
	const { value, path, onChange, reportIssue, binding } = props;
	const resolvedSchema = resolveConfigSchema(props.schema, props.rootSchema ?? props.schema);
	const schema = schemaForValue(resolvedSchema, value);
	const bound = graphObject(value)?.$from;
	const choices = schemaChoices(resolvedSchema);
	const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
	const types = Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string") : typeof schema.type === "string" ? [schema.type] : [];
	const currentKind = valueKind(value);
	const selectTypes = types.length > 1 ? TYPE_OPTIONS.filter(option => types.includes(option.value)) : !types.length && !enumValues && schema.const === undefined && !choices.length ? TYPE_OPTIONS : [];
	return <div className="space-y-2">
		{binding ? <div className="flex flex-wrap gap-1 text-[11px]">
			<button type="button" className="neo-btn" data-size="sm" data-variant={!bound ? "secondary" : "ghost"} onClick={() => { if (bound) onChange(schemaDefault(schema, props.rootSchema)); }}>Literal</button>
			<button type="button" className="neo-btn" data-size="sm" data-variant={bound ? "secondary" : "ghost"} onClick={() => { if (!bound) onChange({ $from: { path: ["result"] } }); }}>Upstream value</button>
		</div> : null}
		{bound && binding ? <BindingEditor value={graphObject(bound) ?? {}} binding={binding} onChange={next => onChange({ $from: next })} path={path} reportIssue={reportIssue} /> : <>
			{choices.length > 1 ? <Select ariaLabel={`${path} schema variant`} value={String(Math.max(0, choices.findIndex(choice => matchesChoice(choice, value))))} options={choices.map((choice, index) => ({ value: String(index), label: typeof choice.title === "string" ? choice.title : choiceLabel(choice, index) }))} onChange={index => onChange(schemaDefault(choices[Number(index)] ?? {}, props.rootSchema))} /> : null}
			{selectTypes.length ? <Select ariaLabel={`${path} value type`} value={currentKind} options={selectTypes} onChange={type => onChange(schemaDefault({ type }))} /> : null}
			{schema.const !== undefined ? <output className="block break-words text-[13px] text-ink-2">{JSON.stringify(schema.const)}</output>
				: enumValues ? <Select ariaLabel={path} value={String(enumValues.findIndex(option => JSON.stringify(option) === JSON.stringify(value)))} options={enumValues.map((option, index) => ({ value: String(index), label: typeof option === "string" ? option : JSON.stringify(option) }))} onChange={index => onChange(enumValues[Number(index)] ?? null)} />
				: currentKind === "object" ? <ObjectFields {...props} schema={schema} value={value as GraphObject} />
				: currentKind === "array" ? <ArrayEditor {...props} schema={schema} value={value as GraphValue[]} />
				: currentKind === "boolean" ? <Select ariaLabel={path} value={String(value)} options={[{ value: "true", label: "True" }, { value: "false", label: "False" }]} onChange={value => onChange(value === "true")} />
				: currentKind === "null" ? <output className="text-[13px] text-ink-3">null</output>
				: currentKind === "number" ? <NumberEditor value={value as number} path={path} onChange={onChange} reportIssue={reportIssue} integer={schema.type === "integer"} />
				: <textarea className={`${inputClass} min-h-[38px] resize-y`} rows={/body|message|prompt|command/i.test(path.split("/").at(-1) ?? "") ? 3 : 1} aria-label={path} value={String(value)} onChange={event => onChange(event.target.value)} />}
		</>}
	</div>;
}
function matchesChoice(choice: GraphObject, value: GraphValue): boolean {
	if (choice.const !== undefined) return JSON.stringify(choice.const) === JSON.stringify(value);
	if (choice.type && choice.type !== valueKind(value) && !(choice.type === "integer" && typeof value === "number")) return false;
	return Object.entries(schemaProperties(choice)).every(([key, schema]) => schema.const === undefined || graphObject(value)?.[key] === schema.const);
}
function choiceLabel(choice: GraphObject, index: number): string {
	const discriminator = Object.values(schemaProperties(choice)).find(field => field.const !== undefined)?.const;
	return typeof discriminator === "string" ? label(discriminator) : typeof choice.type === "string" ? label(choice.type) : `Option ${index + 1}`;
}

function NumberEditor({ value, onChange, path, reportIssue, integer }: { value: number; onChange: (value: number) => void; path: string; reportIssue: ReportIssue; integer?: boolean }) {
	const [text, setText] = useState(String(value));
	useEffect(() => { setText(String(value)); reportIssue(path); }, [value, path, reportIssue]);
	useEffect(() => () => reportIssue(path), [path, reportIssue]);
	return <input type="text" inputMode={integer ? "numeric" : "decimal"} className={inputClass} aria-label={path} value={text} onChange={event => {
		const text = event.target.value; setText(text); const parsed = Number(text);
		if (!text.trim() || !Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) { reportIssue(path, integer ? "Enter a whole number." : "Enter a finite number."); return; }
		reportIssue(path); onChange(parsed);
	}} />;
}

function ObjectFields(props: Omit<ValueProps, "value"> & { value: GraphObject; iteration?: boolean }) {
	const { value, schema, path, onChange, reportIssue, iteration } = props;
	const properties = schemaProperties(schema);
	const required = Array.isArray(schema.required) ? schema.required : [];
	const [newKey, setNewKey] = useState("");
	const keys = [...new Set([...Object.keys(properties), ...Object.keys(value)])];
	const additionalSchema = graphObject(schema.additionalProperties) ?? {};
	return <div className="space-y-4">
		{keys.map(key => {
			const fieldPath = `${path}/${pointer(key)}`;
			const fieldSchema = properties[key] ?? additionalSchema;
			const item = value[key];
			const set = (next: GraphValue) => onChange({ ...value, [key]: next });
			return <section key={key} className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<label className="text-[12px] font-medium text-ink-2">{typeof fieldSchema.title === "string" ? fieldSchema.title : label(key)}{required.includes(key) ? "" : <span className="ml-1 font-normal text-ink-3">optional</span>}</label>
					{item !== undefined && !required.includes(key) ? <button type="button" className="neo-btn" data-size="sm" data-variant="ghost" aria-label={`Remove ${fieldPath}`} onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}><Trash2 size={12} /></button> : null}
				</div>
				{typeof fieldSchema.description === "string" ? <p className="text-[12px] text-ink-3">{fieldSchema.description}</p> : null}
				{item === undefined ? <button type="button" className="neo-btn" data-size="sm" data-variant="ghost" onClick={() => set(schemaDefault(fieldSchema, props.rootSchema ?? schema))}><Plus size={12} />{required.includes(key) ? "Set" : "Add"} {label(key).toLowerCase()}</button>
					: key === "path" && Array.isArray(item) && fieldSchema.type === "array" && graphObject(fieldSchema.items) ? <PathEditor value={item} onChange={set} path={fieldPath} reportIssue={reportIssue} />
						: key === "body" && iteration ? <NativeBodyEditor value={item} onChange={set} path={fieldPath} reportIssue={reportIssue} />
							: <ValueEditor {...props} schema={fieldSchema} value={item} path={fieldPath} onChange={set} />}
			</section>;
		})}
		{schema.additionalProperties !== false ? <div className="flex gap-2">
			<input className={inputClass} aria-label={`New property in ${path}`} placeholder="Property name" value={newKey} onChange={event => setNewKey(event.target.value)} />
			<button type="button" className="neo-btn shrink-0" data-size="sm" data-variant="secondary" disabled={!newKey || Object.hasOwn(value, newKey)} onClick={() => { onChange({ ...value, [newKey]: schemaDefault(additionalSchema, props.rootSchema) }); setNewKey(""); }}><Plus size={12} />Add</button>
		</div> : null}
	</div>;
}

function ArrayEditor(props: Omit<ValueProps, "value"> & { value: GraphValue[] }) {
	const { value, schema, path, onChange } = props;
	const itemSchema = graphObject(schema.items) ?? {};
	return <div className="space-y-3">
		{value.map((item, index) => <div key={index} className="flex items-start gap-2 border-l border-line pl-3">
			<div className="min-w-0 flex-1"><span className="text-[11px] text-ink-3">Item {index + 1}</span><ValueEditor {...props} value={item} schema={itemSchema} path={`${path}/${index}`} onChange={next => onChange(value.map((value, i) => i === index ? next : value))} /></div>
			<button type="button" className="neo-btn" data-size="sm" data-variant="ghost" aria-label={`Remove ${path}/${index}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={12} /></button>
		</div>)}
		<button type="button" className="neo-btn" data-size="sm" data-variant="secondary" onClick={() => onChange([...value, schemaDefault(itemSchema, props.rootSchema)])}><Plus size={12} />Add item</button>
	</div>;
}

function PathEditor({ value, onChange, path, reportIssue }: { value: GraphValue[]; onChange: (value: GraphValue[]) => void; path: string; reportIssue: ReportIssue }) {
	return <div className="space-y-2">
		<p className="text-[12px] text-ink-3">Choose properties in the received output. Inputs retain earlier outputs and the original event.</p>
		<div className="flex flex-wrap gap-1">{[{ label: "Result", value: ["result"] }, { label: "Wrapped value", value: ["result", "value"] }, { label: "Earlier input", value: ["inputs", 0, "result"] }].map(preset => <button key={preset.label} type="button" className="neo-btn" data-size="sm" data-variant="ghost" onClick={() => onChange(preset.value)}>{preset.label}</button>)}</div>
		{value.map((key, index) => <div key={index} className="flex gap-1.5">
			<div className="w-[100px] shrink-0"><Select ariaLabel={`${path}/${index} key type`} value={typeof key === "number" ? "index" : "property"} options={[{ value: "property", label: "Property" }, { value: "index", label: "Index" }]} onChange={type => onChange(value.map((item, i) => i === index ? type === "index" ? 0 : "" : item))} /></div>
			{typeof key === "number" ? <NumberEditor value={key} path={`${path}/${index}`} reportIssue={reportIssue} integer onChange={next => onChange(value.map((item, i) => i === index ? next : item))} /> : <input className={inputClass} aria-label={`${path}/${index}`} value={String(key)} placeholder="Property" onChange={event => onChange(value.map((item, i) => i === index ? event.target.value : item))} />}
			<button type="button" className="neo-btn" data-size="sm" data-variant="ghost" aria-label={`Remove path key ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={12} /></button>
		</div>)}
		<button type="button" className="neo-btn" data-size="sm" data-variant="secondary" onClick={() => onChange([...value, ""])}><Plus size={12} />Add property</button>
	</div>;
}

function BindingEditor({ value, binding, onChange, path, reportIssue }: { value: GraphObject; binding: NonNullable<ValueProps["binding"]>; onChange: (value: GraphObject) => void; path: string; reportIssue: ReportIssue }) {
	const ancestors = useMemo(() => {
		const ids = new Set<string>(); const queue = [binding.node.id];
		for (let index = 0; index < queue.length; index++) for (const edge of binding.graph.edges) if (edge.to.nodeId === queue[index] && !ids.has(edge.from.nodeId)) { ids.add(edge.from.nodeId); queue.push(edge.from.nodeId); }
		return binding.graph.nodes.filter(node => ids.has(node.id));
	}, [binding.graph, binding.node.id]);
	const selected = ancestors.find(node => node.id === value.nodeId);
	const definition = binding.catalogue.find(type => type.type === selected?.type);
	const inputPorts = binding.catalogue.find(type => type.type === binding.node.type)?.inputs ?? [];
	return <div className="space-y-3 border-l border-[var(--neo-accent-a)] pl-3">
		<Field label="Read from"><Select value={typeof value.nodeId === "string" ? value.nodeId : ""} options={[{ value: "", label: "Received input" }, ...ancestors.map(node => ({ value: node.id, label: `${binding.catalogue.find(type => type.type === node.type)?.label ?? node.type} (${node.id})` }))]} onChange={nodeId => { const next = { ...value }; delete next.port; if (nodeId) next.nodeId = nodeId; else delete next.nodeId; onChange(next); }} /></Field>
		{definition?.outputs.length ? <Field label="Output"><Select value={typeof value.port === "string" ? value.port : ""} options={[{ value: "", label: "Any output" }, ...definition.outputs.map(port => ({ value: port.id, label: port.label ?? port.id }))]} onChange={port => { const next = { ...value }; if (port) next.port = port; else delete next.port; onChange(next); }} /></Field> : null}
		{inputPorts.length > 1 ? <Field label="Received through"><Select value={typeof value.inputPort === "string" ? value.inputPort : ""} options={[{ value: "", label: "Any input" }, ...inputPorts.map(port => ({ value: port.id, label: port.label ?? port.id }))]} onChange={inputPort => { const next = { ...value }; if (inputPort) next.inputPort = inputPort; else delete next.inputPort; onChange(next); }} /></Field> : null}
		<PathEditor value={Array.isArray(value.path) ? value.path : []} path={`${path}/$from/path`} reportIssue={reportIssue} onChange={path => onChange({ ...value, path })} />
	</div>;
}

function NativeBodyEditor({ value, onChange, path, reportIssue }: { value: GraphValue; onChange: (value: GraphValue) => void; path: string; reportIssue: ReportIssue }) {
	const [text, setText] = useState(() => JSON.stringify(value, null, 2));
	const [error, setError] = useState<string>();
	useEffect(() => { setText(JSON.stringify(value, null, 2)); }, [value]);
	useEffect(() => () => reportIssue(path), [path, reportIssue]);
	return <div className="space-y-2">
		<p className="text-[12px] text-ink-3">Native body graph JSON. Include one iteration.input source and explicit edges. The server validates the body before saving.</p>
		<textarea aria-label="Iteration body graph JSON" className={`${inputClass} font-mono text-[12px]`} rows={12} value={text} onChange={event => { setText(event.target.value); reportIssue(path, "Apply the edited iteration body before saving."); }} />
		<button type="button" className="neo-btn" data-size="sm" data-variant="secondary" onClick={() => { try { const next: unknown = JSON.parse(text); if (!isGraphValue(next) || !graphObject(next) || graphObject(next)?.version !== 2) throw new Error("Body must be a native version 2 graph."); onChange(next); setError(undefined); reportIssue(path); } catch (error) { const message = String(error); setError(message); reportIssue(path, message); } }}>Apply body</button>
		{error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
	</div>;
}
