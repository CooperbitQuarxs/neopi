import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	cfgChroniclerIndexSummaryResponseMinTokens,
	cfgChroniclerRecallAtomMin,
	cfgChroniclerRecallConfidence,
	cfgChroniclerRecallMaxHops,
	cfgChroniclerRecallMaxNeighbors,
} from "../../src/chronicler/settings";
import {
	indexConfigFromSettings,
	indexConcurrencyFromSettings,
	rankResponsePolicyFromSettings,
	recallDefaultsFromSettings,
	summaryPolicyFromSettings,
} from "../../src/chronicler/temporal/config";
import { loadChronicleCorpus } from "../../src/chronicler/temporal/corpus";
import { indexChronicle } from "../../src/chronicler/temporal/indexer";
import type { ChronicleModelClient } from "../../src/chronicler/temporal/model";
import { createModelRanker, type NodeRanker } from "../../src/chronicler/temporal/rank";
import { recallChronicle } from "../../src/chronicler/temporal/recall";
import { createSummarizer } from "../../src/chronicler/temporal/summarize";
import { buildPlan, overviewTokens, walkPlan } from "../../src/chronicler/temporal/tree";
import { Settings } from "../../src/config/settings";
import { createFakeChronicleModel, writeSessionAtoms } from "./temporal-fixture";

describe("configured Chronicler temporal controls", () => {
	let temp: TempDir;
	let agentDir: string;
	let root: string;

	beforeEach(() => {
		temp = TempDir.createSync("@chronicle-settings-");
		agentDir = temp.path();
		root = path.join(agentDir, "chronicle");
	});
	afterEach(async () => {
		await temp.remove();
	});

	async function corpus() {
		return writeSessionAtoms(path.join(agentDir, "sessions"), {
			cwd: "/work/settings",
			sessionId: "a1a1a1a1-0000-7000-8000-000000000010",
			batches: [
				[
					{
						title: "First recorded event",
						eventTime: "2026-09-02T10:00:00.000Z",
						body: "First recorded event has canonical evidence that can be clipped.",
					},
					{
						title: "Second recorded event",
						eventTime: "2026-09-02T10:01:00.000Z",
						body: "Second recorded event has neighboring canonical evidence.",
					},
				],
			],
		});
	}

	it("applies score thresholds, evidence length, neighbor limit, and hop limit from settings", async () => {
		await corpus();
		const fake = createFakeChronicleModel();
		const settings = Settings.isolated({
			"chronicler.index.timezone": "UTC",
			"chronicler.recall.confidence": 0.8,
			"chronicler.recall.atomMin": 0.2,
			"chronicler.recall.evidenceChars": 12,
			"chronicler.recall.maxNeighbors": 0,
		});
		await indexChronicle({
			agentDir,
			root,
			config: indexConfigFromSettings(settings),
			summarizer: createSummarizer(fake.client),
		});
		const ranker: NodeRanker = {
			kind: "lexical",
			async score(_query, candidates) {
				return { scores: candidates.map(() => 0.7) };
			},
		};
		const recall = () =>
			recallChronicle({ root, query: "recorded event", ranker, ...recallDefaultsFromSettings(settings) });
		const result = await recall();
		expect(result.results).toHaveLength(2);
		expect(
			result.results.every(
				atom => !atom.confident && atom.body.length <= 12 && atom.bodyTruncated && atom.neighbors.length === 0,
			),
		).toBe(true);
		cfgChroniclerRecallConfidence.override(settings, 0.65);
		const confident = await recall();
		expect(confident.results.every(atom => atom.confident && atom.neighbors.length === 0)).toBe(true);
		cfgChroniclerRecallMaxNeighbors.override(settings, 1);
		expect((await recall()).results.every(atom => atom.neighbors.length === 1)).toBe(true);
		cfgChroniclerRecallAtomMin.override(settings, 0.75);
		expect((await recall()).results).toHaveLength(0);
		cfgChroniclerRecallAtomMin.override(settings, 0.2);
		cfgChroniclerRecallMaxHops.override(settings, 1);
		const bounded = await recall();
		expect(bounded.results).toHaveLength(0);
		expect(bounded.trace.filter(step => step.action === "rank")).toHaveLength(1);
	});

	it("uses configured title, slug, overview, and terminal budgets when planning the index", async () => {
		await corpus();
		const settings = Settings.isolated({
			"chronicler.index.timezone": "UTC",
			"chronicler.index.titleChars": 5,
			"chronicler.index.slugChars": 4,
			"chronicler.index.terminalAtoms": 1,
			"chronicler.index.overviewShare": 0.1,
			"chronicler.index.overviewMinTokens": 20,
			"chronicler.index.concurrency": 1,
		});
		const config = indexConfigFromSettings(settings);
		const loaded = await loadChronicleCorpus(path.join(agentDir, "sessions"));
		const plan = buildPlan(loaded.atoms, config)!;
		const terminals = [...walkPlan(plan)].filter(node => node.entries.length > 0);
		expect(terminals).toHaveLength(2);
		expect(terminals.every(node => node.entries.length === 1)).toBe(true);
		const entry = terminals[0]!.entries[0]!;
		expect(entry.route).toContain("First…");
		expect(entry.route.split("\n", 1)[0]).not.toContain("First recorded event");
		expect(entry.stub).toContain("-firs-");
		expect(overviewTokens(config)).toBe(50);
	});

	it("limits actual parallel summary calls with configured index concurrency", async () => {
		await writeSessionAtoms(path.join(agentDir, "sessions"), {
			cwd: "/work/concurrency",
			sessionId: "a1a1a1a1-0000-7000-8000-000000000011",
			batches: [
				Array.from({ length: 8 }, (_, index) => ({
					title: `Recorded event ${index}`,
					eventTime: `2026-09-0${2 + Math.floor(index / 4)}T1${index % 4}:00:00.000Z`,
					body: "Detailed canonical evidence about the recorded event. ".repeat(30),
				})),
			],
		});
		const settings = Settings.isolated({
			"chronicler.index.timezone": "UTC",
			"chronicler.index.hopTokens": 200,
			"chronicler.index.concurrency": 1,
		});
		let active = 0;
		let maxActive = 0;
		let calls = 0;
		const report = await indexChronicle({
			agentDir,
			root,
			config: indexConfigFromSettings(settings),
			concurrency: indexConcurrencyFromSettings(settings),
			summarizer: {
				identity: "test/concurrency",
				async summarize(_node, children) {
					calls++;
					active++;
					maxActive = Math.max(maxActive, active);
					try {
						await Bun.sleep(5);
						return {
							overview: "recorded events",
							descriptions: children.map(() => "recorded detail"),
							truncated: false,
						};
					} finally {
						active--;
					}
				},
			},
		});
		expect(report.complete).toBe(true);
		expect(calls).toBeGreaterThan(1);
		expect(maxActive).toBe(1);
	});

	it("interpolates configured summary word limits into the real completion request", async () => {
		const settings = Settings.isolated({
			"chronicler.index.summaryWordsPerToken": 0.4,
			"chronicler.index.summaryMinWords": 3,
			"chronicler.index.summaryResponseMinTokens": 17,
			"chronicler.index.summaryResponseMultiplier": 3,
			"chronicler.index.summaryResponsePaddingTokens": 13,
		});
		let system = "";
		const responseLimits: number[] = [];
		const client: ChronicleModelClient = {
			identity: "test/summary",
			async complete(prompt, _input, maxTokens) {
				responseLimits.push(maxTokens);
				system = prompt;
				return JSON.stringify({ overview: "saved", children: [{ key: "child", description: "recorded" }] });
			},
		};
		const summarizer = createSummarizer(client, summaryPolicyFromSettings(settings));
		const node = {
			key: "root",
			label: "root",
			level: "root",
			localStart: "2026",
			localEnd: "2026",
			atomCount: 1,
			projects: [],
		};
		await summarizer.summarize(node, [{ ...node, key: "child", text: "recorded" }], {
			overviewTokens: 100,
			childTokens: 5,
			childCeilingTokens: 20,
		});
		expect(system).toContain("overview: at most 40 words");
		expect(system).toContain("each child description: at most 3 words");
		expect(responseLimits).toEqual([373]);
		cfgChroniclerIndexSummaryResponseMinTokens.override(settings, 500);
		await createSummarizer(client, summaryPolicyFromSettings(settings)).summarize(
			node,
			[{ ...node, key: "child", text: "recorded" }],
			{ overviewTokens: 100, childTokens: 5, childCeilingTokens: 20 },
		);
		expect(responseLimits).toEqual([373, 500]);
	});

	it("applies configured ranking response minimum, per-candidate budget, and padding to model calls", async () => {
		const settings = Settings.isolated({
			"chronicler.recall.responseMinTokens": 100,
			"chronicler.recall.responseTokensPerCandidate": 7,
			"chronicler.recall.responsePaddingTokens": 9,
		});
		const candidates = Array.from({ length: 20 }, (_, index) => ({
			key: `candidate-${index}`,
			label: `Period ${index}`,
			text: "recorded event",
		}));
		const responseLimits: number[] = [];
		const client: ChronicleModelClient = {
			identity: "test/ranking",
			async complete(_system, _input, maxTokens) {
				responseLimits.push(maxTokens);
				return JSON.stringify({ scores: candidates.map(candidate => ({ key: candidate.key, score: 5 })) });
			},
		};
		const ranker = createModelRanker(client, rankResponsePolicyFromSettings(settings));
		expect(await ranker.score("recorded event", candidates.slice(0, 1))).toEqual({ scores: [0.5] });
		expect(await ranker.score("recorded event", candidates)).toEqual({ scores: candidates.map(() => 0.5) });
		expect(responseLimits).toEqual([100, 149]);
	});
});
