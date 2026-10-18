import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { isEnoent, isEnotdir, logger, untilAborted } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import * as sessionListing from "../session/session-listing";
import { githubRepoSlugEquals, repoFromRemoteUrl } from "../tools/gh-common";
import { getRemoteUrls } from "../tools/gh-pr-checkout";
import { expandTilde } from "../tools/path-utils";
import { renderError, throwIfAborted } from "../tools/tool-errors";
import { github } from "../utils/github";
import { cfgIssuesCheckouts } from "./settings";

export interface IssueCheckout {
	/** Absolute repository root. */
	path: string;
	/** Host-aware `[HOST/]OWNER/REPO` identity. */
	repo: string;
	linkedWorktree: boolean;
	/** Last activity in session history, in epoch milliseconds. */
	lastActive?: number;
	source: "override" | "foreground" | "history";
}

export interface IssueRepoCandidate {
	repo: string;
	description?: string;
	archived?: boolean;
	fork?: boolean;
	issuesEnabled?: boolean;
	checkouts: IssueCheckout[];
}

export interface IssueTargetInventory {
	foreground?: { cwd: string; repoRoot?: string; repo?: string };
	repositories: IssueRepoCandidate[];
	warnings: string[];
}

interface RemoteRepository {
	nameWithOwner: string;
	description?: string | null;
	isArchived: boolean;
	isFork: boolean;
	hasIssuesEnabled: boolean;
}

interface CheckoutLead {
	cwd: string;
	source: IssueCheckout["source"];
	repo?: string;
	lastActive?: number;
}

interface LocalCheckout {
	path: string;
	linkedWorktree: boolean;
	repo?: string;
}

const SOURCE_PRIORITY = { override: 0, foreground: 1, history: 2 } as const;
const LOCAL_READ_CONCURRENCY = 8;

/** Only the primary remote owns this checkout's local instructions. */
function primaryRemoteRepo(
	remotes: ReadonlyMap<string, string>,
	checkoutPath: string,
	warn: (message: string) => void,
): string | undefined {
	if (remotes.has("origin")) return repoFromRemoteUrl(remotes.get("origin"));
	if (remotes.size === 1) return repoFromRemoteUrl(remotes.values().next().value);
	if (remotes.size > 1) {
		warn(
			`Issue checkout has multiple remotes without an origin at ${checkoutPath}; its primary repository is ambiguous`,
		);
	}
	return undefined;
}

/** Read local identities only; neither discovery nor checkout selection clones or fetches. */
async function readLocalCheckout(
	cwd: string,
	byRoot: Map<string, Promise<LocalCheckout>>,
	warn: (message: string) => void,
	signal?: AbortSignal,
): Promise<LocalCheckout | undefined> {
	throwIfAborted(signal);
	if (!(await fs.stat(cwd)).isDirectory()) return undefined;
	throwIfAborted(signal);
	const repository = vcs.git(cwd);
	if (!repository) return undefined;
	const root = await fs.realpath(repository.info().repoRoot);
	throwIfAborted(signal);
	let pending = byRoot.get(root);
	if (!pending) {
		pending = (async () => {
			const remotes = await getRemoteUrls(root, signal);
			throwIfAborted(signal);
			const repo = primaryRemoteRepo(remotes, root, warn);
			return { path: root, linkedWorktree: Boolean(repository.linkedWorktree()), repo };
		})();
		byRoot.set(root, pending);
	}
	return pending;
}

/** Merge GitHub inventory with verified local leads, preserving host and checkout provenance. */
export async function collectIssueTargetInventory(options: {
	cwd: string;
	settings: Settings;
	signal?: AbortSignal;
	historyLimit?: number;
}): Promise<IssueTargetInventory> {
	const { settings, signal } = options;
	throwIfAborted(signal);
	const cwd = path.resolve(options.cwd);
	const inventory: IssueTargetInventory = { foreground: { cwd }, repositories: [], warnings: [] };
	const warn = (message: string) => {
		inventory.warnings.push(message);
		logger.warn(message);
	};
	const [projects, remoteRepositories] = await Promise.all([
		untilAborted(signal, sessionListing.listRecentProjects(options.historyLimit ?? 200)).catch(error => {
			throwIfAborted(signal);
			warn(`Issue checkout history is unavailable: ${renderError(error)}`);
			return [];
		}),
		github
			.json<RemoteRepository[]>(
				cwd,
				[
					"repo",
					"list",
					"--limit",
					"1000",
					"--json",
					"nameWithOwner,description,isArchived,isFork,hasIssuesEnabled",
				],
				signal,
			)
			.catch(error => {
				throwIfAborted(signal);
				warn(`GitHub repository inventory is unavailable: ${renderError(error)}`);
				return [];
			}),
	]);
	throwIfAborted(signal);

	const leads: CheckoutLead[] = [{ cwd, source: "foreground" }];
	for (const [repo, checkout] of Object.entries(cfgIssuesCheckouts.get(settings))) {
		leads.push({ cwd: path.resolve(expandTilde(checkout)), repo, source: "override" });
	}
	for (const project of projects) {
		if (project.cwd) {
			leads.push({
				cwd: path.resolve(project.cwd),
				source: "history",
				lastActive: project.latest.modified.getTime(),
			});
		}
	}
	const byRoot = new Map<string, Promise<LocalCheckout>>();
	const localCheckouts = new Array<LocalCheckout | undefined>(leads.length);
	let next = 0;
	const readNext = async () => {
		while (next < leads.length) {
			throwIfAborted(signal);
			const index = next++;
			const lead = leads[index];
			try {
				localCheckouts[index] = await readLocalCheckout(lead.cwd, byRoot, warn, signal);
			} catch (error) {
				throwIfAborted(signal);
				// Removed historical directories are normal, not inventory failures.
				if (!isEnoent(error) && !isEnotdir(error)) {
					warn(`Issue checkout could not be inspected at ${lead.cwd}: ${renderError(error)}`);
				}
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(LOCAL_READ_CONCURRENCY, leads.length) }, readNext));
	throwIfAborted(signal);

	const candidateFor = (repo: string): IssueRepoCandidate => {
		const existing = inventory.repositories.find(candidate => githubRepoSlugEquals(candidate.repo, repo));
		if (existing) return existing;
		const candidate: IssueRepoCandidate = { repo, checkouts: [] };
		inventory.repositories.push(candidate);
		return candidate;
	};
	for (let index = 0; index < leads.length; index++) {
		const lead = leads[index];
		const local = localCheckouts[index];
		if (lead.source === "foreground" && local) {
			inventory.foreground = { cwd, repoRoot: local.path, repo: local.repo };
		}
		const expectedRepo = lead.repo;
		if (expectedRepo) {
			candidateFor(expectedRepo);
			if (!githubRepoSlugEquals(local?.repo, expectedRepo)) {
				warn(`Issue checkout override for ${expectedRepo} does not match a local repository at ${lead.cwd}`);
				continue;
			}
		}
		const repo = expectedRepo ?? local?.repo;
		if (!local || !repo) continue;
		const candidate = candidateFor(repo);
		const existing = candidate.checkouts.find(checkout => checkout.path === local.path);
		if (existing) {
			if (SOURCE_PRIORITY[lead.source] < SOURCE_PRIORITY[existing.source]) existing.source = lead.source;
			if (
				lead.lastActive !== undefined &&
				(existing.lastActive === undefined || lead.lastActive > existing.lastActive)
			) {
				existing.lastActive = lead.lastActive;
			}
		} else {
			candidate.checkouts.push({
				path: local.path,
				repo: candidate.repo,
				linkedWorktree: local.linkedWorktree,
				lastActive: lead.lastActive,
				source: lead.source,
			});
		}
	}
	for (const remote of remoteRepositories) {
		const candidate = candidateFor(remote.nameWithOwner);
		candidate.description = remote.description ?? undefined;
		candidate.archived = remote.isArchived;
		candidate.fork = remote.isFork;
		candidate.issuesEnabled = remote.hasIssuesEnabled;
	}
	return inventory;
}

/** Prefer explicit paths, the active checkout, then recent primary and linked checkouts. */
export function selectIssueCheckout(
	candidate: IssueRepoCandidate,
	foregroundRepoRoot?: string,
): IssueCheckout | undefined {
	let selected: IssueCheckout | undefined;
	let selectedRank = Infinity;
	for (const checkout of candidate.checkouts) {
		const rank =
			checkout.source === "override"
				? 0
				: checkout.path === foregroundRepoRoot
					? 1
					: checkout.linkedWorktree
						? 3
						: 2;
		if (rank < selectedRank || (rank === selectedRank && (checkout.lastActive ?? 0) > (selected?.lastActive ?? 0))) {
			selected = checkout;
			selectedRank = rank;
		}
	}
	return selected;
}

/** Re-read remotes at publication time; a nested directory or stale/mismatched checkout is not authority. */
export async function verifyIssueCheckout(
	checkout: IssueCheckout,
	repo: string,
	signal?: AbortSignal,
): Promise<boolean> {
	throwIfAborted(signal);
	try {
		if (!(await fs.stat(checkout.path)).isDirectory()) return false;
		const checkoutPath = await fs.realpath(checkout.path);
		throwIfAborted(signal);
		const repository = vcs.git(checkoutPath);
		if (!repository || (await fs.realpath(repository.info().repoRoot)) !== checkoutPath) return false;
		const remotes = await getRemoteUrls(checkoutPath, signal);
		throwIfAborted(signal);
		return githubRepoSlugEquals(
			primaryRemoteRepo(remotes, checkoutPath, message => logger.warn(message)),
			repo,
		);
	} catch (error) {
		throwIfAborted(signal);
		if (!isEnoent(error) && !isEnotdir(error)) {
			logger.debug("Issue checkout verification failed", { path: checkout.path, error: renderError(error) });
		}
		return false;
	}
}
