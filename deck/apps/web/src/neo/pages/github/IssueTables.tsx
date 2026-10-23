import { useState } from "react";
import { Dot, Empty, formatShortRelative, NeoSelect, SearchInput, Segmented, Table, Toolbar } from "@/components/neo";
import type { GitHubIssue, GitHubPull } from "../../client/github";

export function IssuesTable({ issues, onSelect }: { issues: GitHubIssue[]; onSelect: (issue: GitHubIssue) => void }) {
 const [q, setQ] = useState(""); const [state, setState] = useState<"open" | "closed">("open"); const [label, setLabel] = useState("all");
 const labels = [...new Set(issues.flatMap(i => i.labels))].sort();
 const visible = issues.filter(i => i.state === state && (label === "all" || i.labels.includes(label)) && `${i.number} ${i.title} ${i.author.name}`.toLowerCase().includes(q.toLowerCase()));
 return <><Toolbar><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search title, number or author" /><Segmented label="Issue state" value={state} onChange={setState} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} /><NeoSelect aria-label="Label" value={label} onChange={e => setLabel(e.target.value)}><option value="all">All labels</option>{labels.map(l => <option key={l}>{l}</option>)}</NeoSelect></Toolbar><Table rows={visible} rowKey={i => i.number} rowProps={i => ({ "data-github-item": `issue:${i.number}` })} onRowClick={onSelect} empty={<Empty title="No issues match" hint="Clear the filters or check the full repository on GitHub. This view contains recently updated issues." />} columns={[
  { key: "number", header: "#", width: 64, sort: i => i.number, render: i => <span className="neo-mono neo-dim">#{i.number}</span> },
  { key: "title", header: "Title", sort: i => i.title, render: i => <div className="neo-github-issue-title"><span>{i.title}</span><span className="neo-github-label-text">{i.labels.join(" · ")}</span></div> },
  { key: "author", header: "Author", render: i => i.author.name },
  { key: "updated", header: "Updated", sort: i => i.updatedAt, render: i => <span className="neo-dim">{formatShortRelative(i.updatedAt)}</span> },
 ]} /></>;
}
export function PullsTable({ pulls, viewer, onSelect }: { pulls: GitHubPull[]; viewer: string | null; onSelect: (pull: GitHubPull) => void }) {
 const [q, setQ] = useState(""); const [state, setState] = useState<"open" | "closed">("open"); const [authors, setAuthors] = useState<"all" | "account">("all");
 const visible = pulls.filter(p => p.state === state && (authors === "all" || p.author.name === viewer) && `${p.number} ${p.title} ${p.author.name}`.toLowerCase().includes(q.toLowerCase()));
 return <><Toolbar><SearchInput pageSearch value={q} onChange={setQ} placeholder="Search title, number or author" /><Segmented label="Pull request state" value={state} onChange={setState} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed / merged" }]} />{viewer ? <Segmented label="Pull request author" value={authors} onChange={setAuthors} options={[{ value: "all", label: "All authors" }, { value: "account", label: `By ${viewer}` }]} /> : null}</Toolbar><Table rows={visible} rowKey={p => p.number} rowProps={p => ({ "data-github-item": `pull:${p.number}` })} onRowClick={onSelect} empty={<Empty title="No pull requests match" hint="Clear the filters or check the full repository on GitHub. Only this tracked repository is queried, never its upstream." />} columns={[
  { key: "number", header: "#", render: p => <span className="neo-mono neo-dim">#{p.number}</span> },
  { key: "title", header: "Title", render: p => p.title },
  { key: "author", header: "Author", render: p => p.author.name },
  { key: "branch", header: "Branch", render: p => <span className="neo-mono neo-dim">{p.branch} → {p.base}</span> },
  { key: "checks", header: "Checks", render: p => <div className="neo-github-check-dots">{p.checks.length ? p.checks.map((c, i) => <span key={`${c.name}-${i}`} title={`${c.name}: ${c.state}`} aria-label={`${c.name}: ${c.state}`}><Dot tone={c.state === "success" ? "ok" : c.state === "failure" ? "bad" : "warn"} /></span>) : <span className="neo-dim">Not reported</span>}</div> },
  { key: "review", header: "Review", render: p => p.review },
  { key: "updated", header: "Updated", render: p => <span className="neo-dim">{formatShortRelative(p.updatedAt)}</span> },
 ]} /></>;
}
