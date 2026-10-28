import { useEffect, useState } from "react";
import type { BackendStatusResponse, BackendSwitchResponse } from "@npi-deck/protocol";
import { Card, Dot, KeyValue, NeoButton, NeoSelect, Notice } from "@/components/neo";
import { useStore } from "@/lib/store";
import { formatUptime } from "@/lib/time";
import { shortPath } from "@/lib/utils";
import { settings } from "../../client/settings";
export function EngineSection(){
 const [data,setData]=useState<BackendStatusResponse|null>(null);const [tree,setTree]=useState("");const [report,setReport]=useState("");const [blocked,setBlocked]=useState<BackendSwitchResponse|null>(null);const [busy,setBusy]=useState(false);const [confirm,setConfirm]=useState(false);
 const generation=useStore(s=>s.workerGeneration);const heartbeat=useStore(s=>s.heartbeat);
 useEffect(()=>{void settings.engine.backendStatus().then(d=>{setData(d);setTree(d.desired??d.backends[0]?.id??"");},e=>setReport(String(e)));},[generation]);
 useEffect(()=>{if(!report)return;const timer=setTimeout(()=>setReport(""),4000);return()=>clearTimeout(timer);},[report]);
 async function apply(force:boolean){setBusy(true);try{const probe=await settings.engine.probeBackend(tree);if(!probe.ok){setReport(probe.reason??"This tree could not be loaded.");return;}const result=await settings.engine.switchBackend(tree,force);setBlocked(result.busy?.length?result:null);setReport(result.message);}catch(e){setReport(String(e));}finally{setBusy(false);}}
 async function restart(){setBusy(true);try{setReport((await settings.engine.restartServer()).message);setConfirm(false);}catch(e){setReport(String(e));}finally{setBusy(false);}}
 return <Card id="engine" title="Engine" description="The NeoPi tree serving this office." actions={<><Dot tone={data?.running?"live":undefined}/><span className="neo-settings-description">{data?.running?"Running":"No backend"}</span></>}>
 <div className="neo-settings-stack">{report&&<Notice>{report}</Notice>}{blocked&&<Notice tone="warn"><div>Switch paused. Work is in progress.</div>{blocked.busy?.map(w=><div className="neo-mono" key={w.id}>{w.kind}: {w.id}</div>)}<NeoButton variant="danger" size="sm" onClick={()=>void apply(true)} disabled={busy}>Force switch</NeoButton></Notice>}
 <KeyValue items={[{key:"NeoPi",value:data?.running?.version??"Loading"},{key:"Commit",value:data?.running?.commit?.slice(0,10)??"Unknown"},{key:"Uptime",value:heartbeat?formatUptime(heartbeat.serverStartedAt):"Waiting for heartbeat"},{key:"Source tree",value:data?.running?.path?<span className="neo-settings-path" title={data.running.path}><bdi dir="ltr">{shortPath(data.running.path,36)}</bdi></span>:"No tree loaded"}]}/>
 {data?.reason&&<Notice tone="warn">{data.reason}</Notice>}{data?.pinned&&<p className="neo-settings-description">NPI_DECK_BACKEND pins this launch. Remove it and restart to switch trees.</p>}
 <div className="neo-settings-actions">
  <NeoSelect className="neo-settings-tree-select" aria-label="Switch tree" title={data?.backends.find(backend=>backend.id===tree)?.path} value={tree} onChange={e=>setTree(e.target.value)} disabled={data?.pinned||busy}>
   {data?.backends.map(backend=><option key={backend.id} value={backend.id}>{(backend.id===data.running?.id?data.running.commit?.slice(0,8):backend.id.slice(0,8))??backend.id} · {backend.path.split(/[\\/]/).filter(Boolean).at(-1)}</option>)}
  </NeoSelect>
  <NeoButton disabled={!tree||data?.pinned||busy} onClick={()=>void apply(false)}>Apply</NeoButton>
  <span className="neo-settings-spacer"/>
  {confirm?<><span className="neo-settings-description">Restart the server now?</span><NeoButton variant="danger" disabled={busy} onClick={()=>void restart()}>Confirm restart</NeoButton><NeoButton variant="ghost" onClick={()=>setConfirm(false)}>Cancel</NeoButton></>:<NeoButton className="neo-settings-danger" variant="ghost" onClick={()=>setConfirm(true)}>Restart server</NeoButton>}
 </div></div></Card>;
}
