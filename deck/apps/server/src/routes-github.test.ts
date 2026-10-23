import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildGithubRouter, wheelStage } from "./routes-github.ts";

const scratch = join(homedir(), ".cache/npi-canary/neodeck-pool/GithubWheel/tests");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(join(scratch, "github-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const node = { number: 1, title: "Real issue", body: "Description", state: "OPEN", url: "https://github.com/office/fork/issues/1", updatedAt: "2026-10-22T00:00:00Z", author: { login: "owner" }, labels: { nodes: [{ name: "agent: pending" }] } };
const repository = { nameWithOwner: "office/fork", defaultBranchRef: { name: "main" }, integration: { name: "nightly" }, openIssues: { totalCount: 150 }, openPrs: { totalCount: 2 }, issues: { nodes: [node] }, pullRequests: { nodes: [{ ...node, number: 2, state: "MERGED", mergedAt: node.updatedAt, headRefName: "fix/issue", baseRefName: "nightly", reviewDecision: "APPROVED", comments: { nodes: [] }, commits: { nodes: [] } }] } };
function save(app: ReturnType<typeof buildGithubRouter>, repos: unknown) { return app.request("/github/repos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ repos }) }); }

test("wheel uses explicit labels and GitHub facts, never infers nightly from a merge", () => {
 expect(wheelStage(["agent: pending"], "issue", "OPEN")).toBe("ready");
 expect(wheelStage(["ready", "agent: started"], "issue", "OPEN")).toBe("implementing");
 expect(wheelStage([], "issue", "OPEN")).toBeNull();
 expect(wheelStage(["ready"], "issue", "CLOSED")).toBeNull();
 expect(wheelStage([], "pull", "OPEN")).toBe("pr");
 expect(wheelStage([], "pull", "OPEN", "CHANGES_REQUESTED")).toBe("review");
 expect(wheelStage([], "pull", "MERGED", "APPROVED")).toBe("merged");
 expect(wheelStage(["nightly"], "pull", "MERGED")).toBe("nightly");
});
test("local watchlist persists, rejects CLI arguments and never offers GitHub mutations", async () => {
 const home = join(root, "watchlist"); let calls = 0;
 const app = buildGithubRouter({ home, gh: async () => { calls++; return ""; } });
 expect((await save(app, ["--help"])).status).toBe(400);
 expect((await save(app, ["owner/repo/extra"])).status).toBe(400);
 expect((await save(app, ["office/fork", "office/fork"])).status).toBe(200);
 expect(await (await buildGithubRouter({ home }).request("/github/repos")).json()).toEqual({ repos: ["office/fork"] });
 expect((await app.request("/github/issues", { method: "POST" })).status).toBe(404);
 expect(calls).toBe(0);
});
test("snapshot pins queries to configured fork, preserves counts and isolates failures", async () => {
 const calls: string[][] = [];
 const app = buildGithubRouter({ home: join(root, "snapshot"), gh: async args => { calls.push(args); if (args.includes("name=private")) throw new Error("access denied"); return JSON.stringify({ data: { repository } }); } });
 await save(app, ["office/fork", "office/private"]);
 const response = await app.request("/github/snapshot"); expect(response.status).toBe(200);
 const result = (await response.json()) as { repos: { openIssues: number }[]; issues: { repo: string }[]; wheel: { stage: string }[]; errors: unknown[] };
 expect(result.repos[0]?.openIssues).toBe(150);
 expect(result.issues[0]?.repo).toBe("office/fork");
 expect(result.wheel.map((w: { stage: string }) => w.stage)).toEqual(["ready", "merged"]);
 expect(result.errors).toEqual([{ repo: "office/private", error: "Error: access denied" }]);
 expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
 expect(calls[0]).toContain("owner=office"); expect(calls[0]).toContain("name=fork");
 await app.request("/github/snapshot"); expect(calls.length).toBe(2);
 await save(app, []); expect(((await (await app.request("/github/snapshot")).json()) as { repos: unknown[] }).repos).toEqual([]);
});
