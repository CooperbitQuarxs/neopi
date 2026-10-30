import { Fragment, useId } from "react";
import { ArrowRight, OctagonX } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, NeoBadge } from "@/components/neo";
import type { UsagePool } from "../../client/usage";
import { formatCost } from "@/lib/utils";
export function usageFraction(pool: UsagePool): number {
 const cap = pool.stages.reduce((n,s)=>n+s.cap,0);
 return cap ? Math.min(1,pool.stages.reduce((n,s)=>n+s.used,0)/cap) : 1;
}
export function VirtualModelCard({pool,admin}:{pool:UsagePool;admin:boolean}) {
 const full = usageFraction(pool) >= 1;
 return <Card className="neo-usage-pool" title={<span className="neo-mono">neoproxy/{pool.name}</span>} description={pool.stages.map(s=>s.model.split("/")[1]).join(" then ")} actions={<><span className="neo-usage-cost neo-num">{formatCost(pool.spentUsd)} <span>· {pool.requests.toLocaleString()} requests</span></span><Link className="neo-btn" data-variant="ghost" data-size="sm" to={`/studio?graph=r_${pool.name}`}>Open in Studio</Link></>}>
  <div className="neo-usage-pool-body"><Ring pool={pool}/><div className="neo-chain" aria-label={`${pool.name} demotion chain`}>
   {pool.stages.length > 1 && <><div className="neo-usage-request"><ArrowRight size={14}/><span>Request</span></div><div className="neo-chain-link"><i/></div></>}
   {pool.stages.map((stage,i)=><Fragment key={stage.model}><div className="neo-chain-stage" data-demotion={i>0}>
    <div className="neo-chain-model">{stage.model}</div><div className="neo-chain-meta">{stage.model.startsWith("codex/")?"OpenAI Codex":"Anthropic"} · {stage.accounts === "all" ? `${stage.model.startsWith("codex/")?3:2} accounts` : `${stage.accounts.length} accounts`}{stage.effort?` · ${stage.effort}`:""}</div>
    <div className="neo-meter"><div className="neo-meter-fill" style={{width:`${stage.cap > 0 ? Math.min(100,stage.used/stage.cap*100) : 100}%`}}/></div>
    <div className="neo-chain-budget"><span>{stage.draw} across {stage.accounts === "all" ? stage.model.startsWith("codex/") ? 3 : 2 : stage.accounts.length} accounts</span><span className="neo-num">{(stage.used*100).toFixed(1).replace(/\.0$/,"")} / {stage.cap*100}%</span></div>
    <span className="neo-chain-meta">{stage.perAccount*100}% per account · {stage.window} window</span>
   </div>{pool.stages.length>1&&<div className="neo-chain-link"><i/><span>{i<pool.stages.length-1?"demote":"then"}</span></div>}</Fragment>)}
   <div className="neo-chain-terminal" data-full={full}><OctagonX size={17}/><div><strong>{pool.terminal.kind === "limit"?"User limit":pool.terminal.kind}</strong><span>{full?pool.terminal.message:"Requests stop when your share is used."}</span></div></div>
  </div></div>
  {admin&&<div className="neo-usage-grants"><span>Who can use this</span>{pool.accounts.map(name=><NeoBadge key={name}>{name}</NeoBadge>)}</div>}
 </Card>;
}
function Ring({pool}:{pool:UsagePool}) {
 const id=useId().replace(/:/g,""); const circumference=2*Math.PI*25;
 const total=pool.stages.reduce((n,s)=>n+s.cap,0); let offset=0;
 return <svg className="neo-ring" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${pool.name} ${Math.round(usageFraction(pool)*100)}% used`}>
  <defs><linearGradient id={id}><stop stopColor="var(--neo-accent-a)"/><stop offset="1" stopColor="var(--neo-accent-b)"/></linearGradient></defs>
  {pool.stages.map((s,i)=>{
   const length=(total > 0 ? s.cap/total : 1/pool.stages.length)*circumference;
   const start=offset;offset+=length;
   const filled=s.cap > 0 ? Math.min(1,s.used/s.cap) : 1;
   return <g key={s.model} transform="rotate(-90 28 28)">
    <circle cx="28" cy="28" r="25" fill="none" stroke="rgb(var(--ink-4))" strokeWidth="6" strokeDasharray={`${Math.max(0,length-2)} ${circumference}`} strokeDashoffset={-start}/>
    <circle cx="28" cy="28" r="25" fill="none" stroke={i===0?`url(#${id})`:"rgb(var(--thinking))"} strokeWidth="6" strokeDasharray={`${Math.max(0,(length-2)*filled)} ${circumference}`} strokeDashoffset={-start}/>
   </g>;
  })}
  <text x="28" y="32" textAnchor="middle">{Math.round(usageFraction(pool)*100)}%</text>
 </svg>;
}
