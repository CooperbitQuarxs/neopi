import type { Api, Model } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { sanitizeDisplayLine } from "@oh-my-pi/pi-tui/overlays/extensions/display-text";
import type { ExtensionUIContext } from "../extensibility/extensions/types";
import { resolveModelRoleValue } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";
import { discoverAgents } from "../task/discovery";
import { cfgTaskDisabledAgents, cfgTaskIsolationEnabled } from "../task/settings";
import {
	resolveEffectiveSubagentPolicy,
	reserveStructuredSubagentId,
	runStructuredSubagent,
	type StructuredSubagentRequest,
} from "../task/structured-subagent";

export function launcherEfforts(model: Model<Api>): readonly string[] {
	return getSupportedEfforts(model).length ? getSupportedEfforts(model) : ["off"];
}

export function resolveLauncherModel(selector: string, models: Model<Api>[], settings: Settings): Model<Api> {
	const resolved = resolveModelRoleValue(selector, models, { settings });
	if (!resolved.model || resolved.warning)
		throw new Error(resolved.warning ?? `No available model matches ${selector}.`);
	// The launcher accepts exact slugs and role aliases, not an accidental fuzzy match.
	if (!selector.startsWith("@") && selector !== `${resolved.model.provider}/${resolved.model.id}`) {
		throw new Error("Enter an exact provider/model slug or @role alias. Choose effort in the next field.");
	}
	return resolved.model;
}

/** A new command uses the existing dialogs, spawn primitive, job ownership and Hub registry. */
export async function runAgentLauncher(
	session: AgentSession,
	ui: Pick<ExtensionUIContext, "select" | "input" | "confirm">,
): Promise<string | undefined> {
	const spawnSession = session.getAgentLauncherSession();
	const ownerSessionFile = spawnSession.getSessionFile();
	const discovery = await discoverAgents(spawnSession.cwd, undefined, spawnSession.effectiveExtensionRoots?.());
	const disabled = cfgTaskDisabledAgents.get(session.settings);
	const agents = [...discovery.agents, ...(spawnSession.getSessionAgents?.() ?? [])].filter(
		agent => !disabled.includes(agent.name),
	);
	const type = await ui.select("Launch agent: preset", [
		"subagent",
		"parallel",
		"advisor",
		...agents.map(agent => agent.name),
	]);
	if (type === undefined) return;
	const advisor = type === "advisor";
	const agent = type === "subagent" || type === "parallel" ? "task" : type;
	const selector = await ui.input("Exact provider/model or @role", advisor ? "@advisor" : "@default");
	if (selector === undefined) return;
	const model = resolveLauncherModel(selector.trim(), session.modelRegistry.getAvailable(), session.settings);
	const effort = await ui.select(`Effort for ${sanitizeDisplayLine(`${model.provider}/${model.id}`)}`, [
		...launcherEfforts(model),
	]);
	if (effort === undefined) return;
	if (!launcherEfforts(model).includes(effort)) throw new Error("Choose an effort supported by the selected model.");
	const nameInput = await ui.input("Persistent name, fixed after launch", "WorkerName");
	if (nameInput === undefined) return;
	const name = nameInput.trim();
	if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name))
		throw new Error("Name must start with a letter and contain at most 32 letters, digits, underscores or hyphens.");
	const allowedTools = advisor
		? session.getAdvisorAvailableToolNames()
		: session.getEnabledToolNames().filter(tool => session.hasBuiltInTool(tool));
	const defaultTools = advisor
		? allowedTools
		: (agents.find(candidate => candidate.name === agent)?.tools ?? allowedTools);
	const rawTools = await ui.input(
		`Tools, comma-separated; empty means no tools. Available: ${allowedTools.join(", ")}`,
		defaultTools.filter(tool => allowedTools.includes(tool)).join(","),
	);
	if (rawTools === undefined) return;
	const tools = [
		...new Set(
			rawTools
				.split(",")
				.map(tool => tool.trim())
				.filter(Boolean),
		),
	];
	const unknown = tools.filter(tool => !allowedTools.includes(tool));
	if (unknown.length) throw new Error(`Unavailable tools: ${unknown.join(", ")}`);
	const policy = await ui.select(
		advisor ? "Advisor orchestration policy" : "Worker orchestration policy",
		advisor ? ["turn", "agent-end"] : ["independent", "may-delegate"],
	);
	if (policy === undefined) return;
	if (policy === "may-delegate" && !tools.includes("task"))
		throw new Error("Delegation requires the task tool. Launch again and include it.");
	const isolation =
		advisor || !cfgTaskIsolationEnabled.get(session.settings)
			? "shared"
			: await ui.select("Workspace isolation", ["shared", "isolated"]);
	if (isolation === undefined) return;
	const assignment = await ui.input(advisor ? "Advisor instructions" : "Assignment");
	if (assignment === undefined) return;
	if (!assignment.trim()) throw new Error("An assignment is required.");
	const modelSelector = `${model.provider}/${model.id}:${effort}`;
	const request: StructuredSubagentRequest = {
		session: spawnSession,
		invocationKind: "task",
		agent,
		model: modelSelector,
		confirmedModel: modelSelector,
		assignment,
		tools,
		spawns: policy === "may-delegate" ? "*" : [],
		keepAlive: true,
		detached: true,
		structured: false,
		isolation: { requested: isolation === "isolated", apply: false },
	};
	if (!advisor) {
		if (!spawnSession.asyncJobManager) throw new Error("This session does not support managed background agents.");
		await resolveEffectiveSubagentPolicy(request);
	}
	const preview = [
		`Name: ${name}. Fixed after creation; replacements get a separate identity.`,
		`Preset: ${type}`,
		`Resolved: ${modelSelector}`,
		`Tools: ${tools.join(", ") || "none"}`,
		`Policy: ${policy}; workspace: ${isolation}${isolation === "isolated" ? "; changes are not automatically applied" : ""}`,
		`Initialization and later wake-ups can incur API charges, even without useful work. A prior IndependentFable idle init cost about $0.39; this model's idle-init cost is unknown.`,
		`Model price per million tokens: input $${model.cost.input}, output $${model.cost.output}. Parking retains the name and transcript.`,
		`Assignment: ${assignment}`,
	]
		.map(sanitizeDisplayLine)
		.join("\n");
	if (!(await ui.confirm("Confirm agent launch", preview))) return;
	if (spawnSession.isDisposed?.()) throw new Error("The owning session has closed.");
	if (spawnSession.getSessionFile() !== ownerSessionFile)
		throw new Error("The owning session changed. Launch again in the current session.");
	if (advisor) {
		session.launchAdvisor({
			name,
			model: modelSelector,
			tools,
			instructions: assignment,
			reviewMode: policy === "agent-end" ? "agent-end" : "turn",
		});
		return `Launched advisor ${name}. Open /hub to inspect the seat. This advisor is session-local; /advisor configure still manages saved presets.`;
	}
	const id = await reserveStructuredSubagentId(spawnSession, { label: name });
	if (
		id !== name &&
		!(await ui.confirm(
			"Confirm reserved identity",
			`The name ${name} was already reserved. Launch as ${id}? Names are fixed after creation.`,
		))
	)
		return;
	if (spawnSession.isDisposed?.() || spawnSession.getSessionFile() !== ownerSessionFile)
		throw new Error("The owning session changed. Launch again.");
	spawnSession.asyncJobManager!.register(
		"task",
		id,
		async ({ signal, reportProgress }) => {
			const execution = await runStructuredSubagent({
				...request,
				identity: { id },
				signal,
				onProgress: progress => {
					void reportProgress(`Running ${id}`, { progress: [progress] });
				},
			});
			if (execution.result.exitCode !== 0)
				throw new Error(execution.result.error ?? execution.result.stderr ?? `Agent ${id} failed.`);
			return `Agent ${id} completed.\n${execution.result.output}${execution.mergeSummary}`;
		},
		{ id, agentId: id, ownerId: spawnSession.getAgentId?.() ?? undefined },
	);
	return `Launched ${id} as ${modelSelector}. Open /hub to inspect or message this stable identity.`;
}
