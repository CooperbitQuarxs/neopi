import "./github.css";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, GitBranch, RotateCw, Settings2 } from "lucide-react";
import { Empty, ErrorState, formatShortRelative, NeoButton, Notice, PageHeader, SearchInput, Tabs } from "@/components/neo";
import { github, WHEEL_STAGES, type GitHubSnapshot, type GitHubWheelItem } from "../client/github";
import { ItemInspector, TrackReposDrawer } from "./github/GitHubDrawers";
import { IssuesTable, PullsTable } from "./github/IssueTables";
type Tab = "wheel" | "issues" | "pulls";
export function GitHubPage() {
 const [data, setData] = useState<GitHubSnapshot | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [query, setQuery] = useState(""); const [tab, setTab] = useState<Tab>("wheel");
 const [tracking, setTracking] = useState(false); const [busy, setBusy] = useState(false);
 const [params, setParams] = useSearchParams();
 const refresh = useCallback(async () => { setBusy(true); try { setData(await github.snapshot()); setError(null); } catch (e) { setError(String(e)); } finally { setBusy(false); } }, []);
 useEffect(() => { void refresh(); }, [refresh]);
 const repo = data?.repos.find(r => r.id === params.get("repo")) ?? data?.repos[0];
 function open(kind: "wheel" | "issue" | "pull", id: string) { if (repo) setParams({ repo: repo.id, item: `${kind}:${id}` }); }
 function close() { setParams(repo ? { repo: repo.id } : {}); }
 const wheel = data?.wheel.filter(w => w.repo === repo?.id) ?? [];
 const issues = data?.issues.filter(i => i.repo === repo?.id) ?? []; const pulls = data?.pulls.filter(p => p.repo === repo?.id) ?? [];
 const selection = params.get("item")?.split(":");
 const selectedWheel = selection?.[0] === "wheel" ? wheel.find(w => w.id === selection[1]) : undefined;
 const selectedIssue = selectedWheel?.kind === "issue" ? issues.find(i => i.number === selectedWheel.number) : selection?.[0] === "issue" ? issues.find(i => i.number === Number(selection[1])) : undefined;
 const selectedPull = selectedWheel?.kind === "pull" ? pulls.find(p => p.number === selectedWheel.number) : selection?.[0] === "pull" ? pulls.find(p => p.number === Number(selection[1])) : undefined;
 return <div className="neo-fill neo-github-page">
  <PageHeader title="GitHub" description="The repositories the office tracks. Issues, pull requests and the implementation wheel." actions={<><NeoButton onClick={() => void refresh()} disabled={busy}><RotateCw size={14} />{busy ? "Refreshing" : "Refresh"}</NeoButton><NeoButton onClick={() => setTracking(true)}><Settings2 size={14} />Track repositories</NeoButton></>} />
  {error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
  {data?.errors.map(e => <Notice key={e.repo} tone="warn">{e.repo}: {e.error}</Notice>)}
  <div className="neo-split neo-fill-body"><aside className="neo-split-list">
   <div className="neo-split-list-head"><SearchInput pageSearch value={query} onChange={setQuery} placeholder="Find a repository" size="sm" /></div>
   <div className="neo-split-group">Tracked repositories</div><div className="neo-split-rows">
    {data?.repos.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).map(r => <button key={r.id} type="button" className="neo-row" data-active={repo?.id === r.id} onClick={() => setParams({ repo: r.id })}><span className="neo-row-lead"><GitBranch size={14} /></span><span className="neo-row-title">{r.name.split("/")[1]}</span><span className="neo-row-when">{r.openPrs} PRs</span><span className="neo-row-sub">{r.name.split("/")[0]}</span></button>)}
    {data?.repos.length && !data.repos.some(r => r.name.toLowerCase().includes(query.toLowerCase())) ? <Empty title="No repository matches" hint="Try its owner or repository name." /> : null}
   </div>
  </aside><section className="neo-split-detail">
   {!data && !error ? <p className="neo-github-loading" role="status">Reading GitHub through the server's gh connection…</p> : null}
   {repo ? <><header className="neo-github-repo-head"><div className="neo-github-repo-info"><h2>{repo.name}</h2><span className="neo-dim">{repo.defaultBranch}{repo.integrationBranch ? ` ← ${repo.integrationBranch}` : ""}</span><span className="neo-dim">{repo.openIssues} open issues · {repo.openPrs} open PRs</span></div><a className="neo-btn" data-variant="ghost" data-size="sm" href={`https://github.com/${repo.name}`} target="_blank" rel="noreferrer"><ExternalLink size={12} />Open on GitHub</a></header>
    <Tabs label="Repository" value={tab} onChange={setTab} options={[{ value: "wheel", label: "Wheel" }, { value: "issues", label: "Issues", count: repo.openIssues }, { value: "pulls", label: "Pull requests", count: repo.openPrs }]} />
    <div className="neo-github-content">{tab === "wheel" ? <Wheel items={wheel} selected={selectedWheel?.id} onSelect={w => open("wheel", w.id)} /> : tab === "issues" ? <IssuesTable key={repo.id} issues={issues} onSelect={i => open("issue", String(i.number))} /> : <PullsTable key={repo.id} pulls={pulls} viewer={data?.viewer ?? null} onSelect={p => open("pull", String(p.number))} />}</div>
    <p className="neo-github-snapshot">Read-only · Up to {data?.limit} recently updated issues and PRs per repository · Updated {data ? formatShortRelative(data.fetchedAt) : ""}. Refreshes cached for 30 seconds.</p>
   </> : data ? <Empty icon={GitBranch} title={data.configuredRepos.length ? "Repositories could not be read" : "Choose the office's repositories"} hint={data.configuredRepos.length ? "Check the repository errors above. The server needs gh installed and authenticated with access to these repositories." : "Track owner/repo addresses here. This saves a local watchlist, without creating GitHub Projects or changing GitHub."} action={<NeoButton onClick={() => setTracking(true)}>Track repositories</NeoButton>} /> : null}
  </section></div>
  {repo && (selectedIssue || selectedPull) ? <ItemInspector key={params.get("item")} repo={repo} wheel={selectedWheel} issue={selectedIssue} pull={selectedPull} onClose={close} /> : null}
  {tracking ? <TrackReposDrawer repos={data?.configuredRepos ?? []} onClose={() => setTracking(false)} onSaved={async () => { setTracking(false); await refresh(); }} /> : null}
 </div>;
}
function Wheel({ items, selected, onSelect }: { items: GitHubWheelItem[]; selected?: string; onSelect: (w: GitHubWheelItem) => void }) {
 return <div className="neo-github-wheel-view"><div className="neo-wheel">{WHEEL_STAGES.map((stage, index) => <Fragment key={stage.id}>{index ? <span className="neo-github-wheel-connector" aria-hidden="true">›</span> : null}<section className="neo-github-wheel-stage" data-stage={stage.id}><header><span>{stage.label}</span><span>{items.filter(i => i.stage === stage.id).length}</span></header><div className="neo-github-wheel-cards">{items.filter(i => i.stage === stage.id).map(item => <article key={item.id} className="neo-wheel-card"><button className="neo-github-wheel-open" type="button" data-github-item={`wheel:${item.id}`} aria-pressed={selected === item.id} onClick={() => onSelect(item)}><span className="neo-github-wheel-number">{item.kind === "pull" ? "PR" : "Issue"} #{item.number}</span><span className="neo-github-wheel-title">{item.title}</span><span className="neo-dim">Updated {formatShortRelative(item.since)}</span></button></article>)}{!items.some(i => i.stage === stage.id) ? <p className="neo-github-stage-empty">Nothing here</p> : null}</div></section></Fragment>)}</div><p className="neo-github-wheel-summary">Ready and Implementing follow repository labels. Open PRs and review decisions fill the next boards. Merged is a GitHub fact; Nightly needs an explicit nightly label. This view never moves work or starts an agent.</p></div>;
}
