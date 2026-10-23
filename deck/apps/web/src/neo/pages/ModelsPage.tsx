import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ModelInfo } from "@npi-deck/protocol";
import { Card, Empty, NeoButton, NeoSelect, Notice, PageHeader, SearchInput, Table, type Column } from "@/components/neo";
import { api } from "@/lib/api";
import { RoleAssignments, CustomModelsEditor } from "./settings/ModelsSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import "./settings.css";

const SECTIONS = [{ id: "all", label: "All models" }, { id: "roles", label: "Roles" }, { id: "effort", label: "Effort rules" }, { id: "custom", label: "Custom definitions" }];
export function ModelsPage() {
 const [params, setParams] = useSearchParams();
 const section = params.get("section") ?? "all";
 const [models, setModels] = useState<ModelInfo[] | null>(null);
 const [error, setError] = useState("");
 const [query, setQuery] = useState("");
 const refresh = useCallback(async () => {
  try { setModels((await api.listModels()).models); setError(""); }
  catch (error) { setError(String(error)); }
 }, []);
 useEffect(() => { void refresh(); }, [refresh]);
 const providers = useMemo(() => {
  const rows = new Map<string, boolean>();
  for (const model of models ?? []) rows.set(model.provider, (rows.get(model.provider) ?? false) || model.isAvailable);
  return [...rows].map(([id, available]) => ({ id, available }));
 }, [models]);
 const provider = section.startsWith("provider:") ? section.slice(9) : null;
 const needle = query.trim().toLocaleLowerCase();
 const visible = (models ?? []).filter(model => (!provider || model.provider === provider) && (!needle || [model.provider, model.id, model.label].some(text => text.toLocaleLowerCase().includes(needle))));
 const columns: Column<ModelInfo>[] = [
  { key: "model", header: "Model", wrap: true, render: model => <div className="neo-settings-stack neo-model-name"><strong>{model.label || model.id}</strong><span className="neo-settings-description neo-mono">{model.provider}/{model.id}</span></div> },
  { key: "availability", header: "Access", render: model => <span className="neo-settings-description">{model.isAvailable ? "Available" : "Sign-in required"}</span> },
  { key: "context", header: "Context", align: "right", render: model => <span className="neo-num">{model.contextWindow == null ? "Unknown" : model.contextWindow.toLocaleString()}</span> },
  { key: "input", header: "Input", render: model => <span className="neo-settings-description">{model.inputModes?.length ? model.inputModes.join(", ") : "Unknown"}</span> },
 ];
 function navigate(id: string) { setParams({ section: id }); setQuery(""); }
 return <div className="neo-fill neo-settings-page neo-models-page">
  <PageHeader title="Models" description="NeoPi inference models, role assignments and catalogue extensions." actions={<Link className="neo-btn" data-variant="ghost" to="/settings#engine">Runtime settings</Link>} />
  <div className="neo-settings neo-fill-body">
   <nav className="neo-settings-index neo-models-index" aria-label="Model configuration sections">
    {SECTIONS.map(item => <button type="button" key={item.id} data-active={section === item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}
    <div className="neo-settings-index-heading">Inference providers</div>
    {providers.map(item => <button type="button" key={item.id} className={item.available ? undefined : "neo-model-provider-unavailable"} data-active={section === `provider:${item.id}`} aria-current={section === `provider:${item.id}` ? "page" : undefined} onClick={() => navigate(`provider:${item.id}`)} title={item.available ? item.id : `${item.id}: sign-in required`}>{item.id}</button>)}
    {!models && <span className="neo-settings-description">{error ? "Provider list unavailable" : "Loading providers"}</span>}
   </nav>
   <div className="neo-settings-content">
    <div className="neo-settings-scope"><span className="neo-settings-description">Configuration scope</span><NeoSelect aria-label="Model configuration scope" value="global" disabled title="Project scope requires the newer native Models configuration API"><option value="global">Global</option><option value="project" disabled>Project, requires newer NeoPi</option></NeoSelect></div>
    {error && <Notice tone="warn">{error}<NeoButton size="sm" onClick={() => void refresh()}>Reload catalogue</NeoButton></Notice>}
    {section === "roles" ? <RoleAssignments /> : section === "custom" ? <CustomModelsEditor /> : section === "effort" ? <Card title="Effort rules" description="Rules belong to NeoPi and apply across connected clients."><div className="neo-settings-stack"><Notice tone="warn">The connected NeoPi SDK does not expose scoped effort-rule configuration. This requires get_models_configuration and set_effort_rules. Existing native rules are unchanged.</Notice><p className="neo-settings-description">You can still assign an explicit effort suffix with a role selector, such as provider/model:high. NeoPi validates and resolves the selector. Project-level configuration and rule editing need the native configuration API.</p><Link className="neo-btn" to="?section=roles">Edit role assignments</Link></div></Card> : section === "all" || provider ? <>
     <Card title={provider ?? "All models"} description="The connected NeoPi catalogue, including providers without credentials. This inventory filter is separate from the native conversation switcher." flush actions={<NeoButton size="sm" variant="ghost" onClick={() => void refresh()}>Reload</NeoButton>}>
      <div className="neo-model-inventory-filter"><SearchInput pageSearch aria-label="Filter model inventory" value={query} onChange={setQuery} placeholder="Filter by model or provider" /></div>
      {models ? <Table key={section} columns={columns} rows={visible} limit={80} rowKey={model => `${model.provider}/${model.id}`} empty={<Empty title="No matching models" hint="Try another model or provider name." />} /> : <Empty title={error ? "Model catalogue unavailable" : "Loading model catalogue"} />}
     </Card>
     {provider && <ProvidersSection admin={false} />}
    </> : <Empty title="Unknown model configuration section" hint="Choose All models, Roles, Effort rules or an inference provider." />}
   </div>
  </div>
 </div>;
}
