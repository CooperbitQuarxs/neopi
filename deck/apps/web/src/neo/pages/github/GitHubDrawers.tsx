import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Drawer, Empty, ErrorState, formatShortRelative, NeoButton } from "@/components/neo";
import { Markdown } from "@/lib/markdown";
import { github, WHEEL_STAGES, type GitHubIssue, type GitHubPull, type GitHubWheelItem, type Repo } from "../../client/github";
import { DockInspector } from "../../components/DockInspector";

function Section({ title, children }: { title: string; children: ReactNode }) {
 return <section className="neo-github-detail-section"><h3>{title}</h3>{children}</section>;
}

export function ItemInspector({ repo, issue, pull, wheel, onClose }: { repo: Repo; issue?: GitHubIssue; pull?: GitHubPull; wheel?: GitHubWheelItem; onClose: () => void }) {
 const item = pull ?? issue; if (!item) return null;
 return <DockInspector onClose={onClose} returnFocusSelector={`[data-github-item="${CSS.escape(wheel ? `wheel:${wheel.id}` : `${pull ? "pull" : "issue"}:${item.number}`)}"]`} title={item.title} subtitle={`${repo.name} #${item.number}`} footer={<a className="neo-btn" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open on GitHub</a>}>
  <div className="neo-github-drawer-content"><p className="neo-dim">{pull ? "Pull request" : "Issue"} {item.state}. Opened by {item.author.name}. Updated {formatShortRelative(item.updatedAt)}.{wheel ? ` ${WHEEL_STAGES.find(s => s.id === wheel.stage)?.label}.` : ""}</p>
   {item.labels.length ? <p className="neo-github-label-text">{item.labels.join(" · ")}</p> : null}
   <Section title="Description">{item.body ? <Markdown>{item.body}</Markdown> : <p className="neo-dim">No description provided.</p>}</Section>
   {pull ? <><Section title="Branch"><p className="neo-mono">{pull.branch} → {pull.base}</p></Section><Section title="Checks and review"><p>{pull.review}</p>{pull.checks.length ? <ul className="neo-github-check-list">{pull.checks.map((check, i) => <li key={`${check.name}-${i}`}>{check.name}: {check.state}</li>)}</ul> : <p className="neo-dim">No check results reported.</p>}</Section><Section title="Recent PR comments">{pull.comments.length ? pull.comments.map(comment => <article className="neo-github-comment" key={comment.id}><header><strong>{comment.author.name}</strong><time>{formatShortRelative(comment.at)}</time></header><Markdown>{comment.body}</Markdown></article>) : <Empty title="No conversation comments" hint="Inline review discussions are available on GitHub." />}</Section></> : null}
   <p className="neo-dim">Read-only connection through the server's GitHub CLI. Review discussions and full history are available on GitHub.</p>
  </div>
 </DockInspector>;
}
export function TrackReposDrawer({ repos, onClose, onSaved }: { repos: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
 const [value, setValue] = useState(repos.join("\n")); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
 async function save() { setBusy(true); setError(null); try { await github.trackRepos(value.split(/[\s,]+/).filter(Boolean)); await onSaved(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }
 return <Drawer open onClose={onClose} title="Track repositories" subtitle="The office's local GitHub watchlist" width={520} footer={<><NeoButton onClick={onClose}>Cancel</NeoButton><NeoButton variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save watchlist"}</NeoButton></>}><div className="neo-github-form"><label className="neo-github-field" htmlFor="github-repositories">Repositories<textarea id="github-repositories" className="neo-input neo-github-repositories" value={value} onChange={e => setValue(e.target.value)} placeholder={"PsychedelicShayna/neodeck\nPsychedelicShayna/neopi"} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label><p className="neo-dim">One owner/repo per line, up to 20. Saving changes only this deck's watchlist. It does not create projects or modify repositories, issues, pull requests or labels.</p><p className="neo-dim">The server uses its existing gh login. Private repositories need access in that login. Workspace GitHub remotes are discovered until you save a watchlist.</p>{error ? <ErrorState error={error} /> : null}</div></Drawer>;
}
