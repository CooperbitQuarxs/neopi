import "./settings.css";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { PageHeader } from "@/components/neo";
import { useAccount } from "../client/auth";
import { PreviewChip } from "../components/PreviewChip";
import { NAV_ITEMS } from "../nav";
import { AccountsSection } from "./settings/AccountsSection";
import { AdvancedSection } from "./settings/AdvancedSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { DictationSection } from "./settings/DictationSection";
import { EngineSection } from "./settings/EngineSection";
import { IntegrationsSection } from "./settings/IntegrationsSection";
import { LegacySection } from "./settings/LegacySection";
import { ModelsSection } from "./settings/ModelsSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import { WorkspacesSection } from "./settings/WorkspacesSection";
const SECTIONS=[['engine','Engine'],['providers','Providers'],['models','Models'],['accounts','Accounts'],['integrations','Integrations'],['appearance','Appearance'],['dictation','Dictation'],['workspaces','Workspaces'],['notifications','Notifications'],['legacy','Legacy deck'],['advanced','Advanced']] as const;
export function SettingsPage(){const account=useAccount();const location=useLocation();const column=useRef<HTMLDivElement>(null);const [active,setActive]=useState("engine");const item=NAV_ITEMS.find(i=>i.to==="/settings")!;
useEffect(()=>{const root=column.current;if(!root)return;const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])setActive(visible[0].target.id);},{root,rootMargin:"0px 0px -65% 0px",threshold:0});for(const [id] of SECTIONS){const el=document.getElementById(id);if(el)observer.observe(el);}return()=>observer.disconnect();},[]);
useEffect(()=>{
 const id=location.hash.slice(1);const root=column.current;
 if(!SECTIONS.some(([sectionId])=>sectionId===id)||!root)return;
 let anchored=true;
 const align=()=>{if(!anchored)return;document.getElementById(id)?.scrollIntoView({block:"start",behavior:"instant"});setActive(id);};
 const release=()=>{anchored=false;};
 const observer=new ResizeObserver(align);
 for(const [sectionId] of SECTIONS){const section=document.getElementById(sectionId);if(section)observer.observe(section);}
 root.addEventListener("wheel",release,{passive:true});root.addEventListener("touchstart",release,{passive:true});root.addEventListener("pointerdown",release);
 align();
 return()=>{observer.disconnect();root.removeEventListener("wheel",release);root.removeEventListener("touchstart",release);root.removeEventListener("pointerdown",release);};
},[location.hash]);
return <div className="neo-fill neo-settings-page">
 <PageHeader title={item.label} description={item.blurb} badge={<PreviewChip domains={["accounts","dictation","providers"]}/>}/>
 <div className="neo-settings neo-fill-body">
  <nav className="neo-settings-index" aria-label="Settings sections">
   {SECTIONS.map(([id,label])=><a key={id} href={`#${id}`} data-active={active===id} aria-current={active===id?"location":undefined} onClick={e=>{
    e.preventDefault();
    column.current?.dispatchEvent(new Event("pointerdown"));
    history.replaceState(history.state,"",`#${id}`);
    setActive(id);
    document.getElementById(id)?.scrollIntoView({behavior:document.documentElement.dataset.reduceMotion==="true"?"instant":"smooth",block:"start"});
    window.dispatchEvent(new HashChangeEvent("hashchange"));
   }}>{label}{id==="advanced"&&<span>admin</span>}</a>)}
  </nav>
  <div className="neo-settings-content" ref={column}>
   <EngineSection/><ProvidersSection admin={account?.role==="admin"}/><ModelsSection/><AccountsSection/>
   <IntegrationsSection/><AppearanceSection/><DictationSection/><WorkspacesSection/>
   <NotificationsSection/><LegacySection/><AdvancedSection admin={account?.role==="admin"}/>
  </div>
 </div>
</div>;
}
