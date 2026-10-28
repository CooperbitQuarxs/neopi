import { spawnOwned, terminateOwned } from "../owned-process.ts";

export type GithubIssueCertainty = "not-dispatched" | "rejected" | "uncertain";

/** Messages deliberately exclude gh output, request bodies, credentials, and config. */
export class GithubIssueError extends Error {
	constructor(message: string, readonly certainty: GithubIssueCertainty) {
		super(message);
		this.name = "GithubIssueError";
	}
}

export interface GithubIssueDestination {
	host: string;
	owner: string;
	repo: string;
	/** Stable journal operation identity, reused for reconciliation, never regenerated here. */
	operationId: string;
}

export interface GithubIssueRequest extends GithubIssueDestination {
	title: string;
	body: string;
	labels?: string[];
	assignees?: string[];
	milestone?: number;
	attribution?: { agent: string; onBehalfOf: "PsychedelicShayna" };
}

export interface GithubIssueReceipt extends GithubIssueDestination {
	provider: "github";
	status: "accepted";
	repository: string;
	issue: { id: number; number: number; url: string };
}

export type GithubIssueReconciliation =
	| { status: "found"; receipt: GithubIssueReceipt }
	| { status: "not-found"; safeToRetry: false }
	| { status: "ambiguous"; safeToRetry: false };

export interface GithubIssueCommand {
	args: string[];
	input?: string;
}

export interface GithubIssueCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface GithubIssueTransport {
	execute(command: GithubIssueCommand, signal: AbortSignal): Promise<GithubIssueCommandResult>;
}

/** Uses the existing gh login only; no token provisioning or gh configuration writes. */
export const githubIssueTransport: GithubIssueTransport = {
	async execute(command, signal) {
		if (signal.aborted) throw new GithubIssueError("GitHub operation aborted before dispatch", "not-dispatched");
		// Once spawning starts, a thrown error cannot establish that gh never sent a request.
		const proc = spawnOwned(["gh", ...command.args], {
			stdin: command.input === undefined ? "ignore" : new Blob([command.input]),
			stdout: "pipe", stderr: "pipe", windowsHide: true,
			// Suppress interactive authentication and debug traces; retain existing auth env/config.
			env: { GH_PROMPT_DISABLED: "1", GH_DEBUG: "", GH_PAGER: "cat", NO_COLOR: "1" },
		});
		const onAbort = () => { void terminateOwned(proc); };
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
		try {
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
			]);
			return { stdout, stderr, exitCode };
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	},
};

const DEFAULT_ATTRIBUTION = "> [!NOTE]\n> NeoDeck on behalf of PsychedelicShayna";
const AGENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._/@+():-]{0,119}$/u;
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422, 429]);

function invalid(): never {
	throw new GithubIssueError("Invalid GitHub issue request", "not-dispatched");
}

function validateDestination(request: GithubIssueDestination): void {
	if (!request || typeof request.host !== "string" || request.host.length > 253
		|| !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(request.host)
		|| request.host.split(".").some((part) => !part || part.length > 63 || part.startsWith("-") || part.endsWith("-"))
		|| typeof request.owner !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(request.owner)
		|| typeof request.repo !== "string" || !/^[a-z0-9_.-]{1,100}$/i.test(request.repo) || /^\.{1,2}$/.test(request.repo)
		|| typeof request.operationId !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(request.operationId)) invalid();
}

export function githubIssueOperationMarker(operationId: string): string {
	if (typeof operationId !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(operationId)) invalid();
	return `<!-- neodeck-operation:${operationId} -->`;
}

function issuePayload(request: GithubIssueRequest): string {
	if (!record(request) || Object.keys(request).some((key) => ![
		"host", "owner", "repo", "operationId", "title", "body", "labels", "assignees", "milestone", "attribution",
	].includes(key))) invalid();
	validateDestination(request);
	if (typeof request.title !== "string" || !request.title.trim() || request.title.length > 256
		|| /[\r\n\0]/.test(request.title) || typeof request.body !== "string" || request.body.includes("\0")
		|| request.body.includes("<!-- neodeck-operation:")) invalid();
	let attribution = DEFAULT_ATTRIBUTION;
	if (request.attribution !== undefined) {
		if (!request.attribution || request.attribution.onBehalfOf !== "PsychedelicShayna"
			|| typeof request.attribution.agent !== "string" || !AGENT_NAME.test(request.attribution.agent)) invalid();
		attribution = `> [!NOTE]\n> ${request.attribution.agent} on behalf of PsychedelicShayna`;
	}
	const existing = /^> \[!NOTE\]\r?\n> (.+) on behalf of PsychedelicShayna(?:\r?\n|$)/.exec(request.body);
	const hasAttribution = existing !== null && AGENT_NAME.test(existing[1]!);
	const body = `${hasAttribution ? request.body : `${attribution}\n\n${request.body}`}\n\n${githubIssueOperationMarker(request.operationId)}`;
	if (body.length > 65_536) invalid();
	if (request.labels !== undefined && (!Array.isArray(request.labels) || request.labels.length > 100
		|| request.labels.some((label) => typeof label !== "string" || !label.trim() || label.length > 50 || /[\x00-\x1f\x7f]/.test(label)))) invalid();
	if (request.assignees !== undefined && (!Array.isArray(request.assignees) || request.assignees.length > 10
		|| request.assignees.some((name) => typeof name !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(name)))) invalid();
	if (request.milestone !== undefined && (!Number.isSafeInteger(request.milestone) || request.milestone < 1)) invalid();
	return JSON.stringify({ title: request.title, body, ...(request.labels === undefined ? {} : { labels: request.labels }),
		...(request.assignees === undefined ? {} : { assignees: request.assignees }),
		...(request.milestone === undefined ? {} : { milestone: request.milestone }) });
}

/** Shared dry-run validation: performs no process, authentication, or provider access. */
export function validateGithubIssueRequest(value: unknown): GithubIssueRequest {
	if (!record(value)) invalid();
	const request = value as unknown as GithubIssueRequest;
	issuePayload(request);
	return request;
}

interface ApiResponse { status: number; value: unknown }

function parseResponse(stdout: string): ApiResponse | undefined {
	const match = /^HTTP\/\S+\s+(\d{3})[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*)$/.exec(stdout);
	if (!match) return undefined;
	try { return { status: Number(match[1]), value: JSON.parse(match[2]!) }; }
	catch { return { status: Number(match[1]), value: undefined }; }
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receipt(value: unknown, destination: GithubIssueDestination): GithubIssueReceipt | undefined {
	if (!record(value) || value.pull_request !== undefined || !Number.isSafeInteger(value.id) || Number(value.id) < 1
		|| !Number.isSafeInteger(value.number) || Number(value.number) < 1 || typeof value.html_url !== "string"
		|| typeof value.repository_url !== "string" || typeof value.body !== "string"
		|| !value.body.includes(githubIssueOperationMarker(destination.operationId))) return undefined;
	try {
		const web = new URL(value.html_url);
		const api = new URL(value.repository_url);
		const host = destination.host.toLowerCase();
		const repository = `${destination.owner}/${destination.repo}`;
		const expectedApiHost = host === "github.com" ? "api.github.com" : host;
		if (web.protocol !== "https:" || web.host !== host || web.username || web.password || web.search || web.hash
			|| web.pathname.toLowerCase() !== `/${repository}/issues/${value.number}`.toLowerCase()
			|| api.protocol !== "https:" || api.host !== expectedApiHost || api.username || api.password || api.search || api.hash
			|| api.pathname.toLowerCase() !== `${host === "github.com" ? "" : "/api/v3"}/repos/${repository}`.toLowerCase()) return undefined;
		return { host: destination.host, owner: destination.owner, repo: destination.repo, operationId: destination.operationId,
			provider: "github", status: "accepted", repository,
			issue: { id: Number(value.id), number: Number(value.number), url: web.href } };
	} catch { return undefined; }
}

export class GithubIssuesAdapter {
	constructor(readonly transport: GithubIssueTransport = githubIssueTransport) {}

	async #api(destination: GithubIssueDestination, method: "GET" | "POST", endpoint: string,
		signal: AbortSignal, input?: string): Promise<unknown> {
		if (signal.aborted) throw new GithubIssueError("GitHub operation aborted before dispatch", "not-dispatched");
		const args = ["api", "--hostname", destination.host, "--method", method, "--include", endpoint];
		if (input !== undefined) args.push("--input", "-");
		let result: GithubIssueCommandResult;
		try { result = await this.transport.execute({ args, ...(input === undefined ? {} : { input }) }, signal); }
		catch (error) {
			if (error instanceof GithubIssueError && error.certainty === "not-dispatched") {
				throw new GithubIssueError("GitHub operation stopped before dispatch", "not-dispatched");
			}
			throw new GithubIssueError("GitHub response unavailable; reconcile before retrying", "uncertain");
		}
		const response = parseResponse(result.stdout);
		if (response && REJECTED_STATUSES.has(response.status)) {
			throw new GithubIssueError(`GitHub rejected the request (HTTP ${response.status})`, "rejected");
		}
		// A complete native success response remains useful even if cancellation raced its arrival.
		if (!response || response.status < 200 || response.status >= 300) {
			throw new GithubIssueError("GitHub acceptance is unknown; reconcile before retrying", "uncertain");
		}
		return response.value;
	}

	async create(request: GithubIssueRequest, signal: AbortSignal): Promise<GithubIssueReceipt> {
		const input = issuePayload(request);
		const destination: GithubIssueDestination = { host: request.host, owner: request.owner, repo: request.repo, operationId: request.operationId };
		const value = await this.#api(destination, "POST", `repos/${request.owner}/${request.repo}/issues`, signal, input);
		const accepted = receipt(value, destination);
		if (!accepted) throw new GithubIssueError("GitHub issue identity is unconfirmed; reconcile before retrying", "uncertain");
		return accepted;
	}

	/** A missing search result is not proof of non-acceptance: GitHub indexing can lag. Never rewrites. */
	async reconcile(destination: GithubIssueDestination, signal: AbortSignal): Promise<GithubIssueReconciliation> {
		validateDestination(destination);
		destination = { host: destination.host, owner: destination.owner, repo: destination.repo, operationId: destination.operationId };
		const query = `repo:${destination.owner}/${destination.repo} is:issue in:body "neodeck-operation:${destination.operationId}"`;
		const result = await this.#api(destination, "GET", `search/issues?q=${encodeURIComponent(query)}&per_page=100`, signal);
		if (!record(result) || !Array.isArray(result.items) || typeof result.total_count !== "number" || result.incomplete_results !== false
			|| result.total_count !== result.items.length) return { status: "ambiguous", safeToRetry: false };
		const matching = result.items.filter((item: unknown) => record(item) && typeof item.body === "string"
			&& item.body.includes(githubIssueOperationMarker(destination.operationId)));
		if (matching.length === 0) return { status: "not-found", safeToRetry: false };
		if (matching.length !== 1 || !record(matching[0]) || !Number.isSafeInteger(matching[0].number) || Number(matching[0].number) < 1) {
			return { status: "ambiguous", safeToRetry: false };
		}
		const value = await this.#api(destination, "GET", `repos/${destination.owner}/${destination.repo}/issues/${matching[0].number}`, signal);
		const accepted = receipt(value, destination);
		return accepted ? { status: "found", receipt: accepted } : { status: "ambiguous", safeToRetry: false };
	}
}

export const githubIssuesAdapter = new GithubIssuesAdapter();
