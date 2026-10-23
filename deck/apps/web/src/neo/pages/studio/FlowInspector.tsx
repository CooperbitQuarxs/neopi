import type { RoutineSpec } from "@npi-deck/protocol";
import { Clock, Trash2 } from "lucide-react";
import { NeoButton } from "@/components/neo";
import { StudioPanel } from "./StudioPanel";

export function FlowInspector({ spec, onChange, onDelete, onClose }: { spec?: RoutineSpec; onChange: (spec: RoutineSpec) => void; onDelete?: () => void; onClose: () => void }) {
 return <StudioPanel title="Flow settings" subtitle="Saved to the deck's routine runner" icon={<Clock size={14} />} onClose={onClose} footer={onDelete ? <NeoButton variant="ghost" className="neo-studio-danger" onClick={onDelete}><Trash2 size={13} />Delete flow</NeoButton> : undefined}>
  {spec ? <>
   <label className="neo-field">Name<input className="neo-input" value={spec.name} onChange={event => onChange({ ...spec, name: event.target.value })} /></label>
   <label className="neo-field">Description<textarea className="neo-input" rows={3} value={spec.description ?? ""} onChange={event => onChange({ ...spec, description: event.target.value })} /></label>
   <label className="neo-field">Schedule<input className="neo-input neo-mono" value={spec.trigger.flatMap(trigger => "cron" in trigger ? [trigger.cron] : [])[0] ?? ""} placeholder="On demand, or a cron expression" onChange={event => { const other = spec.trigger.filter(trigger => !("cron" in trigger) && !("manual" in trigger)); onChange({ ...spec, trigger: [...other, ...(event.target.value ? [{ cron: event.target.value }] : [{ manual: {} }])] }); }} /></label>
   <label className="neo-field">Timezone<input className="neo-input" value={spec.timezone ?? ""} placeholder="System timezone" onChange={event => onChange({ ...spec, timezone: event.target.value || undefined })} /></label>
   <label className="neo-field">Tags<input className="neo-input" value={spec.tags?.join(", ") ?? ""} placeholder="office, daily" onChange={event => onChange({ ...spec, tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} /></label>
  </> : <p className="neo-studio-help">Loading the flow's settings…</p>}
  <p className="neo-studio-help">Select a step on the canvas to edit it there. The enabled switch saves at once; Save writes the steps, schedule and these settings together.</p>
 </StudioPanel>;
}
