import "./usage.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AsyncView, Card, Empty, formatElapsed, formatRelativeTime, NeoBadge, NeoSelect, Page, PageHeader, SearchInput, SectionLabel, Segmented, Stat, StatGrid, Switch, Table, type Column } from "@/components/neo";
import { formatCost } from "@/lib/utils";
import { previewAccountRecords as PREVIEW_ACCOUNTS, useAccount } from "../client/auth";
import type { ProviderExposure } from "../client/preview-data";
import { providers, useProviders } from "../client/providers";
import { usage, type UsagePeriod, type UsageRequest, type UsageSummary } from "../client/usage";
import { PreviewChip } from "../components/PreviewChip";
import { NAV_ITEMS } from "../nav";
import { usageFraction, VirtualModelCard } from "./usage/VirtualModelCard";
export function UsagePage() {
 const account=useAccount(); const admin=account?.role==="admin";
 const [period,setPeriod]=useState<UsagePeriod>("week"); const [accountId,setAccountId]=useState("me");
 const [data,setData]=useState<UsageSummary|null>(null);const [error,setError]=useState<string|null>(null); const [search,setSearch]=useState("");
 useEffect(()=>{let current=true;setError(null);void (admin&&accountId!=="me"?usage.account(accountId,period):usage.me(period)).then(v=>{if(current)setData(v);},e=>{if(current)setError(String(e));});return()=>{current=false;};},[period,accountId,admin,account?.id]);
 const item=NAV_ITEMS.find(i=>i.to==="/usage")!;
 const total=data?.pools.reduce((n,p)=>n+p.spentUsd,0)??0;
 const nearest=data?.pools.reduce((a,p)=>usageFraction(p)>usageFraction(a)?p:a);
 const columns:Column<UsageRequest>[]=[
 {key:"at",header:"When",sort:r=>r.at,render:r=><span title={new Date(r.at).toLocaleString()}>{formatRelativeTime(r.at)}</span>},
 {key:"virtual",header:"Virtual model",sort:r=>r.virtualModel,render:r=><span className="neo-mono">neoproxy/{r.virtualModel}</span>},
 {key:"model",header:"Resolved model",sort:r=>r.model,render:r=><span className="neo-mono">{r.model}</span>},
 {key:"where",header:"Where",sort:r=>r.where.kind,render:r=><Link className="neo-chip" to={r.where.href}>{r.where.label}</Link>},
 {key:"tokens",header:"Tokens",align:"right",sort:r=>r.tokens,render:r=><span className="neo-num">{r.tokens.toLocaleString()}</span>},
 {key:"cost",header:"Cost",align:"right",sort:r=>r.costUsd,render:r=><span className="neo-num">{formatCost(r.costUsd)}</span>},
 ];
 return <div className="h-full overflow-y-auto"><Page className="neo-usage"><PageHeader title={item.label} description={item.blurb} badge={<PreviewChip domains={["usage","providers"]}/>} actions={<><Segmented label="Period" value={period} onChange={setPeriod} options={[{value:"today",label:"Today"},{value:"week",label:"This week"},{value:"month",label:"This month"}]}/>{admin&&<NeoSelect aria-label="Usage account" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="me">Account: me</option>{PREVIEW_ACCOUNTS.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</NeoSelect>}</>}/>
 <AsyncView data={data} error={error}>{d=><>
 {admin&&accountId!=="me"&&<><div className="neo-usage-account"><span>{PREVIEW_ACCOUNTS.find(a=>a.id===accountId)?.name}'s usage</span><NeoBadge mono>allotment {d.allotment*100}%</NeoBadge></div><ExposureTable/></>}
 <StatGrid><Stat label="Spent" value={formatCost(total)} foot="API-equivalent cost"/><Stat label="Requests" value={d.requestCount.toLocaleString()} foot={period==="week"?"this week":period==="today"?"today":"this month"}/><Stat label="Nearest limit" value={nearest?`${nearest.name} ${Math.round(usageFraction(nearest)*100)}%`:"No limits"} foot={nearest?`of your ${nearest.name} share`:"No virtual models assigned"}/><Stat label="Resets in" value={formatElapsed(Date.parse(d.resetsAt)-Date.now())} foot={new Date(d.resetsAt).toLocaleDateString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}/></StatGrid>
 <SectionLabel>Virtual models</SectionLabel><div className="neo-usage-pools">{d.pools.map(pool=><VirtualModelCard key={pool.name} pool={pool} admin={admin}/>)}{d.pools.length===0&&<Empty title="No virtual models assigned" hint="Ask an admin to grant a virtual model to this account."/>}</div>
 <Card title="Spend, last 14 days" description="Daily cost at API-equivalent rates" actions={<span className="neo-num">{formatCost(d.spend.reduce((n,p)=>n+p.usd,0))}</span>}><div className="neo-usage-bars">{d.spend.map((p,i)=><div key={p.day} className="neo-usage-bar" title={`${p.day}: ${formatCost(p.usd)}`}><div style={{height:`${Math.max(1,p.usd/Math.max(...d.spend.map(s=>s.usd))*100)}%`}}/><span>{i%2===0?new Date(`${p.day}T12:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric"}):""}</span></div>)}</div></Card>
 <Card title="Requests" description={`${d.requests.length} recent requests`} flush actions={<SearchInput pageSearch value={search} onChange={setSearch} placeholder="Search model or virtual model" aria-label="Search requests" />}><Table columns={columns} rows={d.requests.filter(r=>`${r.model} ${r.virtualModel}`.toLowerCase().includes(search.toLowerCase()))} rowKey={r=>r.id} initialSort={{key:"at",dir:"desc"}} limit={10} empty={<Empty title="No requests match" hint="Clear the search to see recent requests."/>}/></Card>
 </>}</AsyncView></Page></div>;
}
export function ExposureTable() {
 const exposure=useProviders();const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 async function toggle(id:string,hidden:boolean){setBusy(true);try{await providers.setHidden(id,hidden);setError(null);}catch(e){setError(String(e));}finally{setBusy(false);}}
 const columns:Column<ProviderExposure>[]=[{key:"provider",header:"Provider",render:p=>p.label},{key:"accounts",header:"Accounts signed in",render:p=><span className="neo-num">{p.accounts}</span>},{key:"models",header:"Models exposed",render:p=><span className="neo-num">{p.models.length}</span>},{key:"hidden",header:"Hidden in Deck",render:p=><Switch label={`Hide ${p.label} from Deck pickers`} checked={p.hidden} disabled={busy} onChange={v=>void toggle(p.id,v)}/> }];
 return <Card title="Providers" description="Hide providers from Deck pickers in this browser. Models remain served; this does not change NeoProxy exposure." flush>{error&&<div className="neo-error-state" role="alert">{error}</div>}<Table columns={columns} rows={exposure} rowKey={p=>p.id}/></Card>;
}
