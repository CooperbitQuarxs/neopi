import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import type { Context } from "@oh-my-pi/pi-ai";
import { createMockModel, type MockHandler } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { type IssueNotice, runIssueFiling } from "@oh-my-pi/pi-coding-agent/issues/filing";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import * as sdk from "@oh-my-pi/pi-coding-agent/sdk";
import * as sessionListing from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { github } from "@oh-my-pi/pi-coding-agent/utils/github";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

const POLICY_MARKER = "ACME-WIDGET-POLICY-7f3a";
const ISSUE_URL = "https://github.com/acme/widget/issues/7";
const SUBMITTED_BODY = "Raw idea: widgets should wobble.\n\nOpen question: how much wobble?";

function systemText(context: Context): string {
	return (context.systemPrompt ?? []).join("\n");
}

describe("runIssueFiling", () => {
	let modelRegistry!: ModelRegistry;
	let root: string;

	beforeAll(async () => {
		root = path.join(os.tmpdir(), `npi-issue-filing-${Snowflake.next()}`);
		fs.mkdirSync(path.join(root, "auth"), { recursive: true });
		modelRegistry = new ModelRegistry(await sdk.discoverAuthStorage(path.join(root, "auth")));
		modelRegistry.authStorage.keys.setRuntime("openai", "test-key");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(() => {
		modelRegistry.authStorage.keys.removeRuntime("openai");
		removeSyncWithRetries(root);
	});

	it.each(["confirmed", "read-failed", "cancelled"])(
		"asks in the hub, then reports the target checkout's publication (%s)",
		async confirmation => {
			const model = getBundledModel("openai", "gpt-4o-mini");
			if (!model) throw new Error("expected bundled openai/gpt-4o-mini");
			const requestId = Snowflake.next();
			const targetId = `IssueTarget-${requestId}`;
			const authorId = `Issue-${requestId}`;
			const controller = new AbortController();

			// The operator types /issue outside the target repository.
			const foreground = path.join(root, `elsewhere-${requestId}`);
			const checkout = path.join(root, `widget-${requestId}`);
			const sessionDir = path.join(root, `session-${requestId}`);
			fs.mkdirSync(foreground, { recursive: true });
			fs.mkdirSync(checkout, { recursive: true });
			fs.mkdirSync(sessionDir, { recursive: true });
			await $`git init -q && git remote add origin https://github.com/acme/widget.git`.cwd(checkout).quiet();
			fs.writeFileSync(path.join(checkout, "AGENTS.md"), `# Widget rules\n\n${POLICY_MARKER}\n`);

			vi.spyOn(sessionListing, "listRecentProjects").mockResolvedValue([]);
			const createArgs: string[][] = [];
			// The real runner hands `signal` to Bun.spawn; anything but an AbortSignal fails there,
			// which is how a mis-ordered tool execute signature surfaced in the running TUI.
			const requireSignal = (signal: unknown) => {
				if (signal !== undefined && !(signal instanceof AbortSignal))
					throw new Error("gh received a non-AbortSignal");
			};
			vi.spyOn(github, "json").mockImplementation((async (_cwd: string, args: string[], signal?: unknown) => {
				requireSignal(signal);
				const command = args.slice(0, 2).join(" ");
				if (command === "repo list") {
					return [
						{
							nameWithOwner: "acme/widget",
							description: "the harness",
							isArchived: false,
							isFork: false,
							hasIssuesEnabled: true,
						},
						{
							nameWithOwner: "acme/gadget",
							description: "another harness",
							isArchived: false,
							isFork: false,
							hasIssuesEnabled: true,
						},
					];
				}
				if (command === "label list") return [{ name: "enhancement" }, { name: "needs-triage" }];
				if (command === "issue list") return [];
				if (command === "issue view") {
					if (confirmation !== "confirmed") {
						if (confirmation === "cancelled") controller.abort(new Error("cancelled after creation"));
						throw new Error("published record unavailable");
					}
					return {
						number: 7,
						title: "Widgets should wobble",
						url: ISSUE_URL,
						state: "OPEN",
						body: SUBMITTED_BODY,
						labels: [{ name: "enhancement" }, { name: "needs-triage" }],
					};
				}
				throw new Error(`unexpected gh json call: ${args.join(" ")}`);
			}) as typeof github.json);
			vi.spyOn(github, "run").mockImplementation(async (_cwd, args, signal) => {
				requireSignal(signal);
				if (args[0] === "issue" && args[1] === "create") {
					createArgs.push(args);
					return { exitCode: 0, stdout: ISSUE_URL, stderr: "" };
				}
				throw new Error(`unexpected gh run: ${args.join(" ")}`);
			});

			const targetMock = createMockModel({
				responses: [
					{ content: ["Which harness: acme/widget or acme/gadget?"] },
					{
						content: [
							{
								type: "toolCall",
								name: "issue_target",
								arguments: { repo: "acme/widget", reason: "operator said the widget harness" },
							},
						],
					},
					{ content: ["Selected."] },
				],
			});
			const authorResponses: MockHandler[] = [
				{ content: [{ type: "toolCall", name: "issue_labels", arguments: {} }] },
				{
					content: [
						{
							type: "toolCall",
							name: "issue_publish",
							arguments: {
								title: "Widgets should wobble",
								body: SUBMITTED_BODY,
								labels: ["enhancement", "needs-triage"],
							},
						},
					],
				},
				confirmation === "confirmed" ? { content: ["Filed."] } : { throw: "author failed after creation" },
			];
			const authorMock = createMockModel({ responses: authorResponses });

			const originalCreate = sdk.createAgentSession;
			vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => {
				const created = await originalCreate(options);
				const mock = options?.agentId === targetId ? targetMock : authorMock;
				vi.spyOn(created.session.agent, "streamFn").mockImplementation(mock.stream);
				return created;
			});

			const notices: IssueNotice[] = [];
			const manager = new AsyncJobManager({});
			// Session history is empty here; the checkout is known only through the override map.
			const settings = Settings.isolated({
				"retry.enabled": false,
				modelRoles: { issues: "openai/gpt-4o-mini" },
				issues: { checkouts: { "acme/widget": checkout } },
			});
			let replies = 0;
			try {
				const result = await runIssueFiling(
					{
						requestId,
						prose: "idea for the harness: widgets should wobble, not sure how much",
						cwd: foreground,
						model,
						settings,
						modelRegistry,
						asyncJobManager: manager,
						ownerId: "Main",
						sessionDir,
						parentSessionFile: path.join(sessionDir, "parent.jsonl"),
						providerSessionPrefix: `test:${requestId}`,
						notify: async notice => {
							notices.push(notice);
							// The operator answers the question in the Agent Hub.
							if (notice.kind === "question" && replies++ === 0) {
								const session = AgentRegistry.global().get(notice.agentId)?.session;
								if (!session) throw new Error("question agent is not live");
								void session.prompt("the widget one", { streamingBehavior: "steer" });
							}
						},
					},
					{ signal: controller.signal, reportProgress: async () => {} },
				);

				expect(notices.map(notice => notice.kind)).toEqual(["dispatched", "question", "outcome"]);
				const question = notices[1];
				expect(question.kind === "question" && question.agentId).toBe(targetId);
				const outcome = notices[2];
				if (confirmation !== "confirmed") {
					expect(outcome).toMatchObject({
						kind: "outcome",
						outcome: { kind: "published-unread", issue: { repo: "acme/widget", url: ISSUE_URL } },
					});
					expect(result).toContain(ISSUE_URL);
					expect(result).not.toContain("nothing was filed");
					expect(result).not.toContain("Submitted body:");
					expect(createArgs).toHaveLength(1);
					return;
				}
				if (outcome.kind !== "outcome" || outcome.outcome.kind !== "published")
					throw new Error("expected publication");
				expect(outcome.outcome.issue).toEqual({
					repo: "acme/widget",
					number: 7,
					url: ISSUE_URL,
					title: "Widgets should wobble",
					body: SUBMITTED_BODY,
					labels: ["enhancement", "needs-triage"],
				});
				expect(result).toContain(ISSUE_URL);
				expect(result).toContain(SUBMITTED_BODY);

				expect(createArgs).toHaveLength(1);
				const args = createArgs[0];
				expect(args[args.indexOf("--repo") + 1]).toBe("acme/widget");
				expect(args.filter((_, index) => args[index - 1] === "--label")).toEqual(["enhancement", "needs-triage"]);

				// The target agent sees no project policy; the author runs under the checkout's own AGENTS.md.
				expect(systemText(targetMock.calls[0].context)).not.toContain(POLICY_MARKER);
				expect(systemText(authorMock.calls[0].context)).toContain(POLICY_MARKER);
				// Filing-only surface: the issue tools plus read-only file tools. `find` is
				// environment-gated (isFindEnabled), so it may be absent; nothing else may appear.
				const authorTools = authorMock.calls[0].context.tools?.map(tool => tool.name) ?? [];
				expect(authorTools.filter(name => name.startsWith("issue_")).sort()).toEqual([
					"issue_decline",
					"issue_existing_owner",
					"issue_labels",
					"issue_publish",
					"issue_samples",
					"issue_search",
					"issue_view",
				]);
				expect(authorTools).toEqual(expect.arrayContaining(["read", "grep", "glob"]));
				expect(
					authorTools.filter(
						name => !name.startsWith("issue_") && !["read", "grep", "glob", "find"].includes(name),
					),
				).toEqual([]);
			} finally {
				for (const id of [targetId, authorId]) AgentRegistry.global().unregister(id);
				await manager.dispose();
			}
		},
	);
});
