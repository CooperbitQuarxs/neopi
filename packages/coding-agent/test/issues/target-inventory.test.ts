import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { Settings } from "../../src/config/settings";
import { cfgIssuesCheckouts } from "../../src/issues/settings";
import {
	collectIssueTargetInventory,
	selectIssueCheckout,
	verifyIssueCheckout,
	type IssueCheckout,
	type IssueRepoCandidate,
} from "../../src/issues/target-inventory";
import * as sessionListing from "../../src/session/session-listing";
import { defaultGhHost, repoFromRemoteUrl, repoFromUrl } from "../../src/tools/gh-common";
import { github } from "../../src/utils/github";

const REMOTE = "https://github.com/Owner/Project.git";
const REPO = repoFromUrl("https://github.com/Owner/Project")!;

async function git(cwd: string, ...args: string[]): Promise<void> {
	await $`git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null ${args}`
		.cwd(cwd)
		.quiet();
}

async function createRepo(root: string, name: string, remote = REMOTE): Promise<string> {
	const cwd = path.join(root, name);
	await fs.mkdir(cwd);
	await git(cwd, "init", "-q", "-b", "main");
	await git(cwd, "remote", "add", "origin", remote);
	await git(cwd, "commit", "--allow-empty", "-q", "-m", "initial fixture");
	return cwd;
}

function project(cwd: string, modified: number): sessionListing.ProjectSummary {
	return {
		cwd,
		sessionCount: 1,
		latest: {
			path: path.join(cwd, "session.jsonl"),
			id: `project-${modified}`,
			cwd,
			created: new Date(modified),
			modified: new Date(modified),
			messageCount: 2,
			size: 100,
			firstMessage: "fixture",
			allMessagesText: "fixture",
		},
	};
}

function checkout(
	checkoutPath: string,
	source: IssueCheckout["source"],
	lastActive = 0,
	linkedWorktree = false,
): IssueCheckout {
	return { path: checkoutPath, repo: REPO, source, lastActive, linkedWorktree };
}

function candidate(...checkouts: IssueCheckout[]): IssueRepoCandidate {
	return { repo: REPO, checkouts };
}

describe("GitHub remote identity parsing", () => {
	it.each([
		"https://github.com/Owner/Project.git",
		"https://github.com/Owner/Project",
		"git@github.com:Owner/Project.git",
		"ssh://git@github.com/Owner/Project.git",
		"git+ssh://git@github.com/Owner/Project.git",
	])("normalizes %s without a .git suffix", remote => {
		expect(repoFromRemoteUrl(remote)).toBe(REPO);
	});

	it("retains a non-default host for HTTPS and SSH remotes", () => {
		const host = defaultGhHost() === "ghe.inventory.test" ? "other.inventory.test" : "ghe.inventory.test";
		for (const remote of [
			`https://${host}/Owner/Project.git`,
			`git@${host}:Owner/Project.git`,
			`ssh://git@${host}/Owner/Project.git`,
		]) {
			expect(repoFromRemoteUrl(remote)).toBe(`${host}/Owner/Project`);
		}
	});

	it.each([undefined, "", "/tmp/local-repo", "file:///tmp/local-repo", "not a remote"])(
		"ignores non-hosted remote %s",
		remote => {
			expect(repoFromRemoteUrl(remote)).toBeUndefined();
		},
	);
});

describe("issue target inventory (real git)", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "npi-issue-inventory-")));
		vi.spyOn(github, "json").mockResolvedValue([]);
		vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([]);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("merges foreground, override, history and remote metadata by host-aware identity", async () => {
		const foreground = await createRepo(root, "foreground");
		const override = await createRepo(root, "override", "git@github.com:owner/project.git");
		const historical = await createRepo(root, "historical", "ssh://git@github.com/OWNER/PROJECT.git");
		const nested = path.join(historical, "nested");
		await fs.mkdir(nested);
		vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([
			project(historical, 100),
			project(nested, 300),
			project(foreground, 200),
			project(override, 400),
		]);
		vi.spyOn(github, "json").mockResolvedValue([
			{
				nameWithOwner: `${defaultGhHost() === "github.com" ? "" : "github.com/"}OWNER/PROJECT`,
				description: "Project description",
				isArchived: false,
				isFork: true,
				hasIssuesEnabled: true,
			},
		]);
		const homeRelativeOverride = `~/${path.relative(os.homedir(), override)}`;
		const settings = Settings.isolated({ "issues.checkouts": { [REPO.toLowerCase()]: homeRelativeOverride } });
		const inventory = await collectIssueTargetInventory({ cwd: foreground, settings, historyLimit: 25 });

		expect(inventory.warnings).toEqual([]);
		expect(inventory.foreground).toEqual({ cwd: foreground, repoRoot: foreground, repo: REPO });
		expect(inventory.repositories).toHaveLength(1);
		expect(inventory.repositories[0]).toEqual({
			repo: REPO,
			description: "Project description",
			archived: false,
			fork: true,
			issuesEnabled: true,
			checkouts: [
				checkout(foreground, "foreground", 200),
				checkout(override, "override", 400),
				checkout(historical, "history", 300),
			],
		});
		expect(sessionListing.listRecentProjects).toHaveBeenCalledWith(25);
		expect(github.json).toHaveBeenCalledWith(
			foreground,
			["repo", "list", "--limit", "1000", "--json", "nameWithOwner,description,isArchived,isFork,hasIssuesEnabled"],
			undefined,
		);
	});

	it("skips deleted history paths silently, including missing paths inside an existing checkout", async () => {
		const cwd = await createRepo(root, "current");
		vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([
			project(path.join(root, "removed"), 500),
			project(path.join(cwd, "removed"), 600),
		]);
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.warnings).toEqual([]);
		expect(inventory.repositories).toHaveLength(1);
		expect(inventory.repositories[0]?.checkouts).toEqual([
			{ path: cwd, repo: REPO, source: "foreground", linkedWorktree: false, lastActive: undefined },
		]);
		expect(sessionListing.listRecentProjects).toHaveBeenCalledWith(200);
	});

	it("discovers a target outside the foreground repository and identifies linked worktrees", async () => {
		const unrelated = await createRepo(root, "unrelated", "https://github.com/Elsewhere/Other.git");
		const target = await createRepo(root, "target");
		const linked = path.join(root, "linked");
		await git(target, "worktree", "add", "-q", "-b", "test-linked", linked);
		vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([project(linked, 900), project(target, 100)]);
		const inventory = await collectIssueTargetInventory({ cwd: unrelated, settings: Settings.isolated() });
		const found = inventory.repositories.find(item => item.repo === REPO);

		expect(found?.checkouts).toEqual([checkout(linked, "history", 900, true), checkout(target, "history", 100)]);
		expect(found && selectIssueCheckout(found, inventory.foreground?.repoRoot)?.path).toBe(target);
	});

	it("does not merge identical slugs on different hosts", async () => {
		const cwd = await createRepo(root, "current");
		const host = defaultGhHost() === "ghe.inventory.test" ? "other.inventory.test" : "ghe.inventory.test";
		const enterprise = await createRepo(root, "enterprise", `git@${host}:Owner/Project.git`);
		vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([project(enterprise, 200)]);
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.repositories.map(item => item.repo)).toEqual([REPO, `${host}/Owner/Project`]);
	});

	it("retains local targets and a warning when GitHub inventory fails", async () => {
		const cwd = await createRepo(root, "current");
		vi.spyOn(github, "json").mockRejectedValue(new Error("GitHub CLI is not authenticated"));
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.repositories[0]?.checkouts[0]?.path).toBe(cwd);
		expect(inventory.warnings).toEqual([
			"GitHub repository inventory is unavailable: GitHub CLI is not authenticated",
		]);
	});

	it("does not trust an override pointing at a different repository", async () => {
		const cwd = await createRepo(root, "current");
		const wrong = await createRepo(root, "wrong", "https://github.com/Elsewhere/Other.git");
		const settings = Settings.isolated({ "issues.checkouts": { [REPO]: wrong } });
		const inventory = await collectIssueTargetInventory({ cwd, settings });

		expect(inventory.repositories[0]?.checkouts.map(item => item.path)).toEqual([cwd]);
		expect(inventory.warnings).toEqual([
			`Issue checkout override for ${REPO} does not match a local repository at ${wrong}`,
		]);
	});

	it("propagates cancellation instead of treating it as an inventory warning", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			collectIssueTargetInventory({ cwd: root, settings: Settings.isolated(), signal: controller.signal }),
		).rejects.toThrow("Operation aborted");
		expect(github.json).not.toHaveBeenCalled();
	});

	it("verifies fresh remotes and rejects a repointed checkout", async () => {
		const cwd = await createRepo(root, "current");
		const local = checkout(cwd, "override");
		expect(await verifyIssueCheckout(local, REPO.toLowerCase())).toBe(true);
		await git(cwd, "remote", "set-url", "origin", "git@github.com:Elsewhere/Other.git");
		expect(await verifyIssueCheckout(local, REPO)).toBe(false);
	});

	it("never treats a fork checkout's upstream remote as its local repository", async () => {
		const cwd = await createRepo(root, "fork");
		const upstream = repoFromUrl("https://github.com/Upstream/Project")!;
		await git(cwd, "remote", "add", "upstream", "git@github.com:Upstream/Project.git");
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.repositories.map(item => item.repo)).toEqual([REPO]);
		expect(inventory.repositories[0]?.checkouts[0]?.path).toBe(cwd);
		expect(await verifyIssueCheckout(checkout(cwd, "history"), REPO)).toBe(true);
		expect(await verifyIssueCheckout(checkout(cwd, "history"), upstream)).toBe(false);
		const overrideInventory = await collectIssueTargetInventory({
			cwd,
			settings: Settings.isolated({ "issues.checkouts": { [upstream]: cwd } }),
		});
		expect(overrideInventory.repositories.find(item => item.repo === upstream)?.checkouts).toEqual([]);
		expect(overrideInventory.warnings).toEqual([
			`Issue checkout override for ${upstream} does not match a local repository at ${cwd}`,
		]);
	});

	it("uses a single non-origin remote as the primary identity", async () => {
		const cwd = await createRepo(root, "single-remote");
		await git(cwd, "remote", "rename", "origin", "source");
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.foreground?.repo).toBe(REPO);
		expect(inventory.repositories[0]?.checkouts[0]?.path).toBe(cwd);
		expect(await verifyIssueCheckout(checkout(cwd, "history"), REPO)).toBe(true);
	});

	it("warns and rejects ambiguous primary identities when multiple remotes have no origin", async () => {
		const cwd = await createRepo(root, "ambiguous");
		await git(cwd, "remote", "rename", "origin", "source");
		await git(cwd, "remote", "add", "upstream", "https://github.com/Upstream/Project.git");
		const inventory = await collectIssueTargetInventory({ cwd, settings: Settings.isolated() });

		expect(inventory.repositories).toEqual([]);
		expect(inventory.foreground?.repo).toBeUndefined();
		expect(inventory.warnings).toEqual([
			`Issue checkout has multiple remotes without an origin at ${cwd}; its primary repository is ambiguous`,
		]);
		expect(await verifyIssueCheckout(checkout(cwd, "history"), REPO)).toBe(false);
	});

	it("rejects a non-root or missing checkout path", async () => {
		const cwd = await createRepo(root, "current");
		const nested = path.join(cwd, "nested");
		await fs.mkdir(nested);

		expect(await verifyIssueCheckout(checkout(nested, "history"), REPO)).toBe(false);
		expect(await verifyIssueCheckout(checkout(path.join(root, "removed"), "history"), REPO)).toBe(false);
	});
});

describe("issue checkout selection", () => {
	const override = checkout("/override", "override", 1, true);
	const foreground = checkout("/foreground", "foreground", 2, true);
	const oldMain = checkout("/old-main", "history", 3);
	const newMain = checkout("/new-main", "history", 4);
	const oldLinked = checkout("/old-linked", "history", 5, true);
	const newLinked = checkout("/new-linked", "history", 6, true);

	it("prefers an explicit override even over the active linked worktree", () => {
		expect(selectIssueCheckout(candidate(newMain, foreground, override), foreground.path)).toBe(override);
	});

	it("prefers the foreground path regardless of its discovery source or worktree status", () => {
		expect(selectIssueCheckout(candidate(newMain, newLinked, oldLinked), oldLinked.path)).toBe(oldLinked);
	});

	it("prefers the newest primary checkout over even newer linked worktrees", () => {
		expect(selectIssueCheckout(candidate(oldMain, newLinked, newMain, oldLinked))).toBe(newMain);
	});

	it("uses the newest linked worktree when no primary checkout exists", () => {
		expect(selectIssueCheckout(candidate(oldLinked, newLinked))).toBe(newLinked);
	});

	it("returns no checkout rather than cloning when only a remote repository is known", () => {
		expect(selectIssueCheckout(candidate())).toBeUndefined();
	});
});

describe("issues.checkouts setting", () => {
	it("accepts home-relative checkout paths and defaults to an empty map", () => {
		expect(cfgIssuesCheckouts.get(Settings.isolated())).toEqual({});
		const settings = Settings.isolated({ "issues.checkouts": { [REPO]: "~/source/project" } });
		expect(cfgIssuesCheckouts.get(settings)).toEqual({ [REPO]: "~/source/project" });
	});

	// Rows are wrapped so an array value is not spread into zero arguments.
	it.each([[[]], ["~/source/project"], [{ [REPO]: "relative/project" }], [{ [REPO]: 42 }]])(
		"rejects malformed checkout mapping %j",
		(value: unknown) => {
			expect(() => Settings.isolated({ "issues.checkouts": value })).toThrow("issues.checkouts");
		},
	);
});
