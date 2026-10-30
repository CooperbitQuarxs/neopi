import { BookOpen, Clock, GitFork, KanbanSquare, Plus, Route, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, ErrorState, NeoButton, PageHeader, SearchInput, formatShortRelative } from "@/components/neo";
import { studio, type GraphKind, type GraphSummary } from "../../client/studio";
import { PreviewChip } from "../../components/PreviewChip";
import { NAV_ITEMS } from "../../nav";
import { KIND_LABELS, type BuildableKind } from "./vocab";

export const KIND_ICONS: Record<GraphKind, typeof Workflow> = { flow: Clock, pipeline: Workflow, router: Route, classifier: GitFork, boardflow: KanbanSquare, map: BookOpen };
/** One sentence per kind, saying what a graph of that kind models and where it runs. */
const SECTIONS: { kind: GraphKind; title: string; read: string }[] = [
 { kind: "flow", title: "Flows", read: "Routines the deck runs itself, on a schedule or when something happens. These are live." },
 { kind: "pipeline", title: "Pipelines", read: "An event or input moving through models, logic and actions, top to bottom." },
 { kind: "router", title: "Routers", read: "How a virtual model draws from accounts, stage by stage, and what happens when every stage is spent. Kept in this browser until NeoProxy can save them." },
 { kind: "classifier", title: "Classifiers", read: "A question that sorts text into labelled branches, such as what kind of thing just landed in the inbox." },
 { kind: "boardflow", title: "Board flows", read: "The columns and gates a card passes through on its way to done." },
 { kind: "map", title: "Map", read: "Every note in Knowledge and the links between them. Built from the notes; read-only here." },
];

export function studioPath(id: string): string { return `/studio/${encodeURIComponent(id)}`; }

/** Studio's list page: every graph by kind. Opening one goes to its full-width canvas. */
export function StudioIndex({ onCreate }: { onCreate: (kind: BuildableKind) => Promise<void> }) {
 const page = NAV_ITEMS.find(item => item.to === "/studio")!;
 const [graphs, setGraphs] = useState<GraphSummary[]>(), [error, setError] = useState(""), [search, setSearch] = useState("");
 useEffect(() => { void studio.list().then(setGraphs).catch(reason => setError(String(reason))); }, []);
 const needle = search.trim().toLowerCase();
 const visible = useMemo(() => (graphs ?? []).filter(g => `${g.name} ${g.description}`.toLowerCase().includes(needle)), [graphs, needle]);
 return <div className="neo-page neo-studio-index">
  <PageHeader title={page.label} description="Graphs model how work moves through the office. Open one to edit it on a full canvas." actions={<SearchInput pageSearch value={search} onChange={setSearch} placeholder="Find a graph" aria-label="Find a graph" width={240} />} />
  {error ? <ErrorState error={error} /> : !graphs ? <p className="neo-studio-help">Loading graphs…</p> : <>
   {SECTIONS.map(section => {
    const items = visible.filter(g => g.kind === section.kind);
    if (needle && items.length === 0) return null;
    const Icon = KIND_ICONS[section.kind];
    return <section key={section.kind} className="neo-studio-section" aria-labelledby={`studio-${section.kind}`}>
     <header><div><h2 id={`studio-${section.kind}`}><Icon size={15} />{section.title}{section.kind === "router" ? <PreviewChip domains={["studioRouters"]} what="Routers" /> : null}</h2><p>{section.read}</p></div>
      {section.kind !== "map" ? <NeoButton size="sm" variant="ghost" onClick={() => void onCreate(section.kind as BuildableKind).catch(reason => setError(String(reason)))}><Plus size={13} />New {KIND_LABELS[section.kind].toLowerCase()}</NeoButton> : null}</header>
     {items.length === 0 ? <p className="neo-studio-section-empty">No {section.title.toLowerCase()} yet. New {KIND_LABELS[section.kind].toLowerCase()} starts one on an empty canvas.</p> : <ul className="neo-studio-rows">
      {items.map(g => <li key={g.id}><Link to={studioPath(g.id)} className="neo-studio-graph-row">
       <span className="neo-studio-graph-name"><span className={g.kind === "router" ? "neo-mono" : undefined}>{g.kind === "router" ? `neoproxy/${g.name.replace(/^neoproxy\//, "")}` : g.name}</span><small>{g.description || "No description"}</small></span>
       {g.kind !== "map" ? <span className="neo-studio-dot" data-on={g.enabled || undefined}><i />{g.enabled ? "Enabled" : "Off"}</span> : <span className="neo-studio-dot" data-on="true"><i />Live</span>}
       <span className="neo-studio-graph-meta">{g.kind === "map" ? "" : <><span className="neo-num">{g.nodes}</span> node{g.nodes === 1 ? "" : "s"}</>}</span>
       <span className="neo-studio-graph-meta">{g.kind === "map" ? "" : g.lastRun ? <>{g.lastRun.ok === false ? "failed" : g.lastRun.ok ? "passed" : "ran"} {formatShortRelative(g.lastRun.at)}</> : "never run"}</span>
      </Link></li>)}
     </ul>}
    </section>;
   })}
   {needle && visible.length === 0 ? <Empty icon={Workflow} title="No graph matches" hint="Clear the search, or start a new graph from one of the sections." /> : null}
  </>}
 </div>;
}
