import { Hono } from "hono";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "./env-store.ts";
import { spawnOwned } from "./owned-process.ts";

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
const fields = `number title body state url updatedAt author { login } labels(first:100) { nodes { name } }`;
const query = `query($owner:String!,$name:String!) { viewer { login } repository(owner:$owner,name:$name) {
 nameWithOwner defaultBranchRef { name } integration:ref(qualifiedName:"refs/heads/nightly") { name }
 openIssues:issues(states:OPEN) { totalCount } openPrs:pullRequests(states:OPEN) { totalCount }
 issues(first:100,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${fields} } }
 pullRequests(first:100,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${fields} mergedAt headRefName baseRefName reviewDecision
 comments(last:20) { nodes { id body createdAt author { login } } }
 commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100) { nodes { __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }
 } }
} }`;
type Node = { number: number; title: string; body: string; state: string; url: string; updatedAt: string; author: { login: string } | null; labels: { nodes: { name: string }[] }; mergedAt?: string; headRefName?: string; baseRefName?: string; reviewDecision?: string; comments?: { nodes: { id: string; body: string; createdAt: string; author: { login: string } | null }[] }; commits?: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: { name?: string; context?: string; state?: string; status?: string; conclusion?: string }[] } } | null } }[] } };
type Repository = { nameWithOwner: string; defaultBranchRef: { name: string } | null; integration: { name: string } | null; openIssues: { totalCount: number }; openPrs: { totalCount: number }; issues: { nodes: Node[] }; pullRequests: { nodes: Node[] } };
export type Gh = (args: string[], signal?: AbortSignal) => Promise<string>;
export const runGh: Gh = async (args, signal) => {
 signal?.throwIfAborted();
 const proc = spawnOwned(["gh", ...args], { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
 const abort = () => proc.kill();
 signal?.addEventListener("abort", abort, { once: true });
 try {
  const [text, error, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (signal?.aborted) throw new Error("GitHub refresh reached its 45 second deadline. Refresh to try again.");
  if (code !== 0) throw new Error(error.trim() || "GitHub CLI failed. Run gh auth login on the server.");
  return text;
 } finally { signal?.removeEventListener("abort", abort); }
};
function author(value: { login: string } | null) { return { name: value?.login ?? "ghost", hue: 260 }; }
function item(repo: string, node: Node) { return { repo, number: node.number, title: node.title, body: node.body, url: node.url, state: node.state === "OPEN" ? "open" : "closed", labels: node.labels.nodes.map(l => l.name), author: author(node.author), updatedAt: node.updatedAt }; }
export function wheelStage(labels: string[], kind: "issue" | "pull", state: string, review?: string): string | null {
 const names = new Set(labels.map(l => l.toLowerCase()));
 if (["nightly", "state: nightly", "status: nightly"].some(l => names.has(l))) return "nightly";
 if (kind === "pull") return state === "MERGED" ? "merged" : state === "CLOSED" ? null : review || ["review", "review: requested", "review: open (codex)"].some(l => names.has(l)) ? "review" : "pr";
 if (state !== "OPEN") return null;
 if (["implementing", "agent: started", "human: started", "state: implementing"].some(l => names.has(l))) return "implementing";
 if (["ready", "agent: pending", "state: ready"].some(l => names.has(l))) return "ready";
 return null;
}
export function buildGithubRouter(opts: { gh?: Gh; home?: string; workspaces?: string[] } = {}) {
 const app = new Hono(); const gh = opts.gh ?? runGh; const home = opts.home ?? getDataDir(); const file = join(home, "github-repos.json");
 type Snapshot = Awaited<ReturnType<typeof snapshot>>;
 let generation = 0; let pending: { generation: number; result: Promise<Snapshot> } | null = null; let cached: { at: number; value: Snapshot } | null = null;
 async function configured(): Promise<string[]> {
  try { return validate(JSON.parse(await readFile(file, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (process.env.NPI_DECK_GITHUB_REPOS) return validate(process.env.NPI_DECK_GITHUB_REPOS.split(/[\s,]+/).filter(Boolean));
  const repos: string[] = [];
  for (const cwd of (opts.workspaces ?? []).slice(0, 20)) {
   try { const proc = spawnOwned(["git", "remote", "get-url", "origin"], { cwd, stdout: "pipe", stderr: "ignore", timeout: 3000 }); const remote = (await new Response(proc.stdout).text()).trim(); if (await proc.exited !== 0) continue; const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/); if (match && REPO.test(match[1]!)) repos.push(match[1]!); } catch { /* Non-git workspaces have no repository to discover. */ }
  }
  return [...new Set(repos)];
 }
 function validate(value: unknown): string[] { if (!Array.isArray(value) || value.length > 20 || value.some(r => typeof r !== "string" || !REPO.test(r))) throw new Error("Use up to 20 GitHub repositories in owner/repo form."); return [...new Set(value as string[])]; }
 app.get("/github/repos", async c => c.json({ repos: await configured() }));
 app.put("/github/repos", async c => {
  let repos: string[]; try { repos = validate((await c.req.json()).repos); } catch (error) { return c.json({ error: String(error) }, 400); }
  await mkdir(home, { recursive: true, mode: 0o700 }); const temp = `${file}.${crypto.randomUUID()}`;
  await writeFile(temp, JSON.stringify(repos), { mode: 0o600 }); await rename(temp, file); generation++; cached = null;
  return c.json({ repos });
 });
 async function snapshot() {
  const names = await configured();
  const repos: { id: string; name: string; defaultBranch: string; integrationBranch: string | null; openIssues: number; openPrs: number; lastNightly: null }[] = [];
  const issues: ReturnType<typeof item>[] = [];
  const pulls: (ReturnType<typeof item> & { branch?: string; base?: string; review: string; comments: { id: string; body: string; author: ReturnType<typeof author>; at: string }[]; checks: { name: string; state: string }[] })[] = [];
  const wheel: { id: string; kind: string; repo: string; number: number; title: string; stage: string; since: string; timeline: never[] }[] = [];
  const errors: { repo: string; error: string }[] = [];
  let viewer: string | null = null;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 45_000);
  let next = 0;
  async function worker() {
   for (;;) {
    const name = names[next++]; if (!name) return;
    if (controller.signal.aborted) { errors.push({ repo: name, error: "Refresh deadline reached. Refresh to try again." }); continue; }
    try {
    const [owner, repoName] = name.split("/"); const result = JSON.parse(await gh(["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${repoName}`], controller.signal));
    if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join("; "));
    viewer = result.data?.viewer?.login ?? viewer;
    const repo: Repository = result.data.repository; if (!repo) throw new Error("Repository not found or access denied.");
    repos.push({ id: name, name: repo.nameWithOwner, defaultBranch: repo.defaultBranchRef?.name ?? "Unknown", integrationBranch: repo.integration?.name ?? null, openIssues: repo.openIssues.totalCount, openPrs: repo.openPrs.totalCount, lastNightly: null });
    for (const [kind, nodes] of [["issue", repo.issues.nodes], ["pull", repo.pullRequests.nodes]] as const) for (const node of nodes) {
     const base = item(name, node);
     if (kind === "issue") issues.push(base); else pulls.push({ ...base, branch: node.headRefName, base: node.baseRefName, review: node.reviewDecision === "APPROVED" ? "approved" : node.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : "waiting", comments: node.comments?.nodes.map(c => ({ id: c.id, body: c.body, author: author(c.author), at: c.createdAt })) ?? [], checks: (node.commits?.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(c => ({ name: c.name ?? c.context ?? "Check", state: ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion ?? c.state ?? "") ? "success" : ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(c.conclusion ?? c.state ?? "") ? "failure" : "pending" })) });
     const stage = wheelStage(base.labels, kind, node.state, node.reviewDecision); if (stage) wheel.push({ id: `${kind}-${node.number}`, kind, repo: name, number: node.number, title: node.title, stage, since: node.mergedAt ?? node.updatedAt, timeline: [] });
    }
    } catch (error) { errors.push({ repo: name, error: String(error) }); }
   }
  }
  try { await Promise.all(Array.from({ length: Math.min(4, names.length) }, () => worker())); }
  finally { clearTimeout(deadline); }
  repos.sort((a, b) => names.indexOf(a.id) - names.indexOf(b.id));
  return { repos, issues, pulls, wheel, viewer, configuredRepos: names, errors, fetchedAt: new Date().toISOString(), limit: 100 };
 }
 app.get("/github/snapshot", async c => {
  if (cached && Date.now() - cached.at < 30_000) return c.json(cached.value);
  if (!pending || pending.generation !== generation) {
   const current = generation;
   const result = snapshot().then(value => { if (current === generation) cached = { at: Date.now(), value }; return value; }).finally(() => { if (pending?.generation === current) pending = null; });
   pending = { generation: current, result };
  }
  try { return c.json(await pending.result); } catch (error) { return c.json({ error: String(error) }, 502); }
 });
 return app;
}
