import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
	GithubIssueError, GithubIssuesAdapter, githubIssueOperationMarker, validateGithubIssueRequest,
	type GithubIssueCommandResult, type GithubIssueRequest, type GithubIssueTransport,
} from "./github-issues.ts";

afterEach(() => { mock.restore(); });

const request: GithubIssueRequest = {
	host: "github.com", owner: "PsychedelicShayna", repo: "neodeck", operationId: "routine-161:node-2",
	title: "An issue $(not a command)", body: "The resolved body; `not a shell`.\nSecond line.",
};
const signal = () => new AbortController().signal;
function nativeIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { id: 12345, number: 42, html_url: "https://github.com/PsychedelicShayna/neodeck/issues/42",
		repository_url: "https://api.github.com/repos/PsychedelicShayna/neodeck",
		body: `Provider body\n\n${githubIssueOperationMarker(request.operationId)}`, ...overrides };
}
function http(value: unknown, status = 201, exitCode = 0): GithubIssueCommandResult {
	return { exitCode, stdout: `HTTP/2.0 ${status} Status\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}`, stderr: "" };
}
function fixture() {
	const transport: GithubIssueTransport = { async execute() { throw new Error("Unexpected transport call"); } };
	const execute = spyOn(transport, "execute").mockResolvedValue(http(nativeIssue()));
	return { adapter: new GithubIssuesAdapter(transport), execute };
}

test("create sends exactly one gh API write with JSON stdin and confirms native identity", async () => {
	const { adapter, execute } = fixture();
	const result = await adapter.create({ ...request, labels: ["needs triage", "bug"], assignees: ["PsychedelicShayna"], milestone: 7 }, signal());
	expect(execute).toHaveBeenCalledTimes(1);
	const command = execute.mock.calls[0]![0];
	expect(command.args).toEqual(["api", "--hostname", "github.com", "--method", "POST", "--include",
		"repos/PsychedelicShayna/neodeck/issues", "--input", "-"]);
	expect(JSON.parse(command.input!)).toEqual({ title: request.title,
		body: `> [!NOTE]\n> NeoDeck on behalf of PsychedelicShayna\n\n${request.body}\n\n${githubIssueOperationMarker(request.operationId)}`,
		labels: ["needs triage", "bug"], assignees: ["PsychedelicShayna"], milestone: 7 });
	expect(result).toEqual({ host: request.host, owner: request.owner, repo: request.repo, operationId: request.operationId,
		provider: "github", status: "accepted", repository: "PsychedelicShayna/neodeck",
		issue: { id: 12345, number: 42, url: "https://github.com/PsychedelicShayna/neodeck/issues/42" } });
});

test("valid explicit body attribution is preserved without a second captain prefix", async () => {
	const { adapter, execute } = fixture();
	const body = "> [!NOTE]\n> GPT-6.1 Sol on behalf of PsychedelicShayna\n\nIssue text";
	await adapter.create({ ...request, body }, signal());
	expect(JSON.parse(execute.mock.calls[0]![0].input!).body).toBe(`${body}\n\n${githubIssueOperationMarker(request.operationId)}`);
});

test("structured explicit attribution uses the supplied agent identity", async () => {
	const { adapter, execute } = fixture();
	await adapter.create({ ...request, attribution: { agent: "GPT-6.1 Sol", onBehalfOf: "PsychedelicShayna" } }, signal());
	expect(JSON.parse(execute.mock.calls[0]![0].input!).body).toStartWith("> [!NOTE]\n> GPT-6.1 Sol on behalf of PsychedelicShayna\n\n");
});

test("an unrecognized identity in body text cannot replace the captain attribution", async () => {
	const { adapter, execute } = fixture();
	await adapter.create({ ...request, body: "> [!NOTE]\n> Somebody on behalf of someone-else\n\nIssue" }, signal());
	expect(JSON.parse(execute.mock.calls[0]![0].input!).body).toStartWith("> [!NOTE]\n> NeoDeck on behalf of PsychedelicShayna\n\n");
});

test.each([
	{ host: "https://github.com" }, { host: "--hostname" }, { owner: "../owner" }, { repo: "repo/other" },
	{ repo: ".." }, { operationId: "operation --> forged" }, { title: " " }, { title: "line\nbreak" },
	{ body: "<!-- neodeck-operation:forged -->" }, { body: "bad\0body" }, { labels: ["bad\nlabel"] },
	{ assignees: ["--flag"] }, { milestone: 0 }, { milestone: 1.5 }, { unsupportedOption: true },
	{ attribution: { agent: "bad\nidentity", onBehalfOf: "PsychedelicShayna" } },
])("invalid resolved request is rejected before any dispatch: %j", async (patch) => {
	const { adapter, execute } = fixture();
	const invalid = { ...request, ...patch } as GithubIssueRequest;
	expect(() => validateGithubIssueRequest(invalid)).toThrow(GithubIssueError);
	await expect(adapter.create(invalid, signal())).rejects.toMatchObject({ certainty: "not-dispatched" });
	expect(execute).not.toHaveBeenCalled();
});

test("dry-run validation requires no transport and accepts supported resolved fields", () => {
	const { execute } = fixture();
	expect(validateGithubIssueRequest({ ...request, labels: [], assignees: [], milestone: 1 })).toMatchObject(request);
	expect(execute).not.toHaveBeenCalled();
});

test("pre-aborted signal prevents dispatch", async () => {
	const { adapter, execute } = fixture();
	const controller = new AbortController(); controller.abort();
	await expect(adapter.create(request, controller.signal)).rejects.toMatchObject({ certainty: "not-dispatched" });
	expect(execute).not.toHaveBeenCalled();
});

test("abort racing a complete native acceptance does not erase the receipt", async () => {
	const { adapter, execute } = fixture();
	const controller = new AbortController();
	execute.mockImplementation(async () => { controller.abort(); return http(nativeIssue()); });
	expect((await adapter.create(request, controller.signal)).issue.number).toBe(42);
});

test("transport loss after dispatch is uncertain and never retried or leaked", async () => {
	const { adapter, execute } = fixture();
	execute.mockRejectedValue(new Error("GH_TOKEN=secret; private config and body"));
	try {
		await adapter.create(request, signal());
		throw new Error("Expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(GithubIssueError);
		expect(error).toMatchObject({ certainty: "uncertain" });
		expect(String(error)).not.toContain("secret");
		expect(String(error)).not.toContain("config");
	}
	expect(execute).toHaveBeenCalledTimes(1);
});

test("native acceptance survives a nonzero exit after the complete provider response", async () => {
	const { adapter, execute } = fixture();
	execute.mockResolvedValue(http(nativeIssue(), 201, 143));
	expect((await adapter.create(request, signal())).issue.number).toBe(42);
});

test("abort with lost provider output remains uncertain rather than authorizing a retry", async () => {
	const { adapter, execute } = fixture();
	const controller = new AbortController();
	execute.mockImplementation(async () => { controller.abort(); throw new Error("interrupted"); });
	await expect(adapter.create(request, controller.signal)).rejects.toMatchObject({ certainty: "uncertain" });
	expect(execute).toHaveBeenCalledTimes(1);
});

test.each([400, 401, 403, 404, 422, 429])("native HTTP %i is a definite rejection without exposing provider text", async (status) => {
	const { adapter, execute } = fixture();
	execute.mockResolvedValue(http({ message: "secret token and private request" }, status, 1));
	await expect(adapter.create(request, signal())).rejects.toMatchObject({ certainty: "rejected", message: `GitHub rejected the request (HTTP ${status})` });
});

test.each([
	{ exitCode: 0, stdout: "https://github.com/PsychedelicShayna/neodeck/issues/42", stderr: "" },
	{ exitCode: 0, stdout: "", stderr: "" },
	http({ message: "timeout" }, 504, 1), http({ message: "timeout" }, 408, 1),
	http({ message: "missing identity" }), http(nativeIssue({ id: undefined })),
	http(nativeIssue({ repository_url: "https://api.github.com/repos/elsewhere/other" })),
	http(nativeIssue({ html_url: "https://github.com/elsewhere/other/issues/42" })),
	http(nativeIssue({ html_url: "https://github.com/PsychedelicShayna/neodeck/issues/43" })),
	http(nativeIssue({ body: "No operation marker" })), http(nativeIssue({ pull_request: {} })),
])("missing or inconsistent native acceptance remains uncertain: %#", async (response) => {
	const { adapter, execute } = fixture(); execute.mockResolvedValue(response);
	await expect(adapter.create(request, signal())).rejects.toMatchObject({ certainty: "uncertain" });
	expect(execute).toHaveBeenCalledTimes(1);
});

test("explicit enterprise host confirms both native API and issue repository identities", async () => {
	const { adapter, execute } = fixture();
	execute.mockResolvedValue(http(nativeIssue({ html_url: "https://ghe.example/PsychedelicShayna/neodeck/issues/42",
		repository_url: "https://ghe.example/api/v3/repos/PsychedelicShayna/neodeck" })));
	expect((await adapter.create({ ...request, host: "ghe.example" }, signal())).host).toBe("ghe.example");
	expect(execute.mock.calls[0]![0].args).toContain("ghe.example");
});

test("reconciliation scopes marker search and confirms a matching issue using reads only", async () => {
	const { adapter, execute } = fixture();
	execute.mockResolvedValueOnce(http({ total_count: 1, incomplete_results: false, items: [nativeIssue()] }, 200))
		.mockResolvedValueOnce(http(nativeIssue(), 200));
	const result = await adapter.reconcile(request, signal());
	expect(result).toMatchObject({ status: "found", receipt: { status: "accepted", issue: { id: 12345, number: 42 } } });
	expect(execute).toHaveBeenCalledTimes(2);
	for (const [command] of execute.mock.calls) {
		expect(command.args).toContain("GET"); expect(command.args).not.toContain("POST"); expect(command.input).toBeUndefined();
	}
	const search = new URL(`https://github.com/${execute.mock.calls[0]![0].args.at(-1)}`);
	expect(search.searchParams.get("q")).toBe(`repo:PsychedelicShayna/neodeck is:issue in:body "neodeck-operation:${request.operationId}"`);
	expect(execute.mock.calls[1]![0].args.at(-1)).toBe("repos/PsychedelicShayna/neodeck/issues/42");
});

test.each([
	{ total_count: 0, incomplete_results: false, items: [], expected: "not-found" },
	{ total_count: 1, incomplete_results: true, items: [nativeIssue()], expected: "ambiguous" },
	{ total_count: 101, incomplete_results: false, items: [nativeIssue()], expected: "ambiguous" },
	{ total_count: 2, incomplete_results: false, items: [nativeIssue(), nativeIssue({ number: 43 })], expected: "ambiguous" },
	{ total_count: 1, incomplete_results: false, items: [nativeIssue({ body: "approximate search match" })], expected: "not-found" },
])("missing, incomplete, and duplicate reconciliation never authorize another write: $expected", async ({ expected, ...response }) => {
	const { adapter, execute } = fixture(); execute.mockResolvedValue(http(response, 200));
	expect(await adapter.reconcile(request, signal())).toEqual({ status: expected, safeToRetry: false });
	expect(execute).toHaveBeenCalledTimes(1);
});

test("reconciliation cannot accept a native read whose operation marker has disappeared", async () => {
	const { adapter, execute } = fixture();
	execute.mockResolvedValueOnce(http({ total_count: 1, incomplete_results: false, items: [nativeIssue()] }, 200))
		.mockResolvedValueOnce(http(nativeIssue({ body: "Edited after search indexing" }), 200));
	expect(await adapter.reconcile(request, signal())).toEqual({ status: "ambiguous", safeToRetry: false });
});
