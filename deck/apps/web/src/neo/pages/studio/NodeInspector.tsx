import { Trash2, SlidersHorizontal, Workflow } from "lucide-react";
import { Check, NeoButton, NeoSelect, SectionLabel } from "@/components/neo";
import { ModelPicker } from "../../components/ModelPicker";
import type { StudioGraph, StudioNode } from "../../client/studio";
import { KIND_LABELS, nodePorts, nodeType, studioNodeExecution, type Field } from "./vocab";
import { nodeTitle } from "./StudioCanvas";
import { StudioPanel } from "./StudioPanel";

const SUPPORT = { local: "Runs inside the deck when executed.", action: "Acts outside the canvas when executed.", preview: "No executor yet: preview runs skip it and Execute refuses the graph." } as const;

/** Graph settings: what the whole graph is called, what it listens to, where it is kept. */
export function GraphSettings({ graph, stored, onChange, onDeleteGraph, onClose }: { graph: StudioGraph; stored: string; onChange: (graph: StudioGraph) => void; onDeleteGraph: () => void; onClose: () => void }) {
 function settingChanged(key: string, value: unknown): void {
  const type = key === "virtualModel" ? "router.entry" : key === "message" ? "router.terminal" : key === "question" ? "cls.ask" : undefined;
  onChange({ ...graph, settings: { ...graph.settings, [key]: value }, nodes: type ? graph.nodes.map(item => item.type === type ? { ...item, config: { ...item.config, [key]: value } } : item) : graph.nodes });
 }
 return <StudioPanel title="Graph settings" subtitle={KIND_LABELS[graph.kind]} icon={<SlidersHorizontal size={14} />} onClose={onClose} footer={<NeoButton variant="ghost" className="neo-studio-danger" onClick={onDeleteGraph}><Trash2 size={13} />Delete graph</NeoButton>}>
  <label className="neo-field">Name<input className="neo-input" value={graph.name} onChange={e => onChange({ ...graph, name: e.target.value })} /></label>
  <label className="neo-field">Description<textarea className="neo-input" rows={3} value={graph.description} onChange={e => onChange({ ...graph, description: e.target.value })} /></label>
  {settingsFields(graph).map(field => <ConfigField key={field.key} field={field} value={graph.settings[field.key]} onChange={value => settingChanged(field.key, value)} />)}
  <dl className="neo-studio-facts"><div><dt>Nodes</dt><dd>{graph.nodes.length}</dd></div><div><dt>Connections</dt><dd>{graph.edges.length}</dd></div><div><dt>Kept in</dt><dd>{stored}</dd></div></dl>
  <SectionLabel>On the canvas</SectionLabel>
  <ul className="neo-studio-keys"><li><kbd>Add node</kbd> or drag from a port to build</li><li><kbd>Delete</kbd> removes the selected node or connection</li><li><kbd>Esc</kbd> closes this panel</li><li>Ports connect when their types match; an any port takes every type</li></ul>
 </StudioPanel>;
}

export function NodeInspector({ graph, node, onChange, onDelete, onClose }: { graph: StudioGraph; node: StudioNode; onChange: (graph: StudioGraph) => void; onDelete: (id: string) => void; onClose: () => void }) {
 const type = nodeType(node.type); const ports = nodePorts(node);
 function update(key: string, value: unknown): void { onChange({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, config: { ...n.config, [key]: value } } : n) }); }
 return <StudioPanel title={nodeTitle(node)} subtitle={type ? `${type.label}. ${type.blurb}` : node.type} icon={<Workflow size={14} />} onClose={onClose} footer={<NeoButton variant="ghost" className="neo-studio-danger" onClick={() => onDelete(node.id)} title="Delete node (Delete key on the canvas)"><Trash2 size={13} />Delete node</NeoButton>}>
  <p className="neo-studio-support" data-support={studioNodeExecution(node.type)}><i />{SUPPORT[studioNodeExecution(node.type)]}</p>
  <label className="neo-field">Node title<input className="neo-input" value={String(node.config.name ?? "")} onChange={e => update("name", e.target.value)} /></label>
  {type?.fields.map(field => <ConfigField key={field.key} field={field} value={node.config[field.key]} onChange={value => update(field.key, value)} />)}
  <section className="neo-studio-ports"><SectionLabel>Ports</SectionLabel>{(["inputs", "outputs"] as const).map(direction => <div key={direction}><h3>{direction === "inputs" ? "Inputs" : "Outputs"}</h3>{ports[direction].length === 0 ? <p className="neo-studio-help">None</p> : ports[direction].map(port => <div className="neo-studio-port" key={port.id}><span><i />{port.label}</span><code>{port.type}</code></div>)}</div>)}</section>
 </StudioPanel>;
}
function settingsFields(graph: StudioGraph): Field[] {
 switch (graph.kind) {
  case "router": return [{ key: "virtualModel", label: "Virtual model", control: "text", placeholder: "neoproxy/heavy" }, { key: "message", label: "Limit message", control: "textarea" }];
  case "classifier": return [{ key: "question", label: "Question", control: "textarea" }];
  case "boardflow": return [{ key: "board", label: "Board", control: "text" }, { key: "project", label: "Project", control: "text" }];
  case "pipeline": return [{ key: "trigger", label: "Trigger", control: "text" }];
  default: return [];
 }
}
function ConfigField({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
 const id = `studio-field-${field.key}`;
 function inputChanged(text: string): void {
  if (field.control === "percent") onChange(Math.max(0, Math.min(100, Number(text))));
  else if (field.control === "number") onChange(Number(text));
  else if (field.key === "accounts") onChange(text === "all" ? "all" : text.split(",").map(account => account.trim()));
  else onChange(text);
 }
 if (field.control === "boolean") return <Check checked={Boolean(value)} onChange={onChange}>{field.label}</Check>;
 return <div className="neo-field"><label htmlFor={field.control === "model" ? undefined : id}>{field.label}{field.control === "percent" ? <span className="neo-studio-field-unit">%</span> : null}</label>
 {field.control === "model" ? (
  <ModelPicker value={String(value ?? "neoproxy/small")} onChange={onChange} />
 ) : field.control === "textarea" ? (
  <textarea id={id} className="neo-input" rows={4} value={String(value ?? "")} placeholder={field.placeholder} onChange={event => onChange(event.target.value)} />
 ) : field.control === "select" ? (
  <NeoSelect id={id} value={String(value ?? field.options?.[0] ?? "")} onChange={event => onChange(event.target.value)}>
   {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
  </NeoSelect>
 ) : (
  <input id={id} className={`neo-input${field.control === "cron" ? " neo-mono" : ""}`} type={field.control === "number" || field.control === "percent" ? "number" : "text"} min={field.control === "percent" ? 0 : undefined} max={field.control === "percent" ? 100 : undefined} value={String(value ?? "")} placeholder={field.placeholder} onChange={event => inputChanged(event.target.value)} />
 )}
 {field.help ? <small className="neo-studio-help">{field.help}</small> : null}</div>;
}
