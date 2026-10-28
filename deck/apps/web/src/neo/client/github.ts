import type { Repo, WheelItem, WheelStage } from "./preview-data";
export type { Repo, WheelStage };
export interface GitHubAuthor { name: string; hue: number }
export interface GitHubIssue { repo: string; number: number; title: string; body: string; url: string; state: "open" | "closed"; labels: string[]; author: GitHubAuthor; updatedAt: string }
export interface GitHubCheck { name: string; state: "success" | "pending" | "failure" }
export interface GitHubComment { id: string; author: GitHubAuthor; body: string; at: string; path?: string }
export interface GitHubPull extends GitHubIssue { branch: string; base: string; checks: GitHubCheck[]; review: "waiting" | "changes requested" | "approved"; comments: GitHubComment[] }
export interface WheelEvent { stage: WheelStage; at: string; detail: string }
export interface GitHubWheelItem extends WheelItem { kind: "issue" | "pull"; timeline: WheelEvent[] }
export interface GitHubSnapshot { repos: Repo[]; issues: GitHubIssue[]; pulls: GitHubPull[]; wheel: GitHubWheelItem[]; viewer: string | null; configuredRepos: string[]; errors: { repo: string; error: string }[]; fetchedAt: string; limit: number }
export const WHEEL_STAGES: readonly { id: WheelStage; label: string }[] = [{ id: "ready", label: "Ready" }, { id: "implementing", label: "Implementing" }, { id: "pr", label: "PR open" }, { id: "review", label: "Review" }, { id: "merged", label: "Merged" }, { id: "nightly", label: "Nightly" }];
async function request<T>(path: string, options?: RequestInit): Promise<T> {
 const response = await fetch(`/api/github${path}`, options);
 const result = await response.json();
 if (!response.ok) throw new Error(result.error ?? `GitHub request failed (${response.status}).`);
 return result as T;
}
export const github = {
 snapshot: () => request<GitHubSnapshot>("/snapshot"),
 trackRepos: (repos: string[]) => request<{ repos: string[] }>("/repos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ repos }) }),
};
