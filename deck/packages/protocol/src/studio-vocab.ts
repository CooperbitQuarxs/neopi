import type { StudioNode } from "./studio";

export type GraphKind = "flow" | "pipeline" | "router" | "classifier" | "boardflow" | "map";
export type BuildableKind = Exclude<GraphKind, "map">;
/** A typed connection point in the graph vocabulary served by /api/graphs/node-types. */
export interface Port { id: string; label: string; type: "event" | "text" | "json" | "decision" | "request" | "any" }
/** One editable configuration field. Values live in StudioNode.config. */
export interface Field { key: string; label: string; control: "text" | "textarea" | "number" | "select" | "model" | "boolean" | "percent" | "cron"; options?: string[]; placeholder?: string; help?: string }
/** Serializable node vocabulary. Icon names are resolved by the canvas, not by the backend. */
export interface NodeType { type: string; kind: GraphKind; label: string; blurb: string; category: string; icon: string; tone?: "engine" | "accent"; inputs: Port[]; outputs: Port[]; fields: Field[] }
const port = (id: string, type: Port["type"], label = id): Port => ({ id, label, type });
const field = (key: string, label: string, control: Field["control"] = "text", options?: string[]): Field => ({ key, label, control, ...(options ? { options } : {}) });
const model = field("model", "Model", "model");
const labels = { ...field("labels", "Labels"), help: "Separate branch labels with commas. Each label creates an output." };
function node(type: string, kind: GraphKind, label: string, blurb: string, category: string, icon: string, inputs: Port[], outputs: Port[], fields: Field[] = [], tone?: NodeType["tone"]): NodeType { return { type, kind, label, blurb, category, icon, inputs, outputs, fields, tone }; }
const input = [port("input", "any", "Input")];
const output = [port("output", "any", "Output")];
export const NODE_TYPES: readonly NodeType[] = [
 ...[
  ["pr_opened", "PR opened", "Start when a pull request opens."], ["inbox_captured", "Inbox captured", "Start with a new inbox item."], ["webhook", "Webhook", "Accept an incoming webhook."], ["schedule", "Schedule", "Run on a cron schedule."], ["message", "Thread message", "Start with a message in a thread."],
 ].map(([id, label, blurb]) => node(`event.${id}`, "pipeline", label!, `${blurb} Studio uses supplied sample input; automatic subscriptions belong to flows.`, "Triggers", "Zap", [], [port("event", "event", "Event")], id === "schedule" ? [field("cron", "Schedule", "cron")] : id === "webhook" ? [field("path", "Webhook path"), { ...field("secretRef", "Secret reference"), help: "Name a managed secret, never paste a credential into a graph." }] : [field(id === "message" ? "thread" : "filter", id === "message" ? "Thread" : "Event filter")])),
 node("event.manual", "pipeline", "Manual input", "Start with the input supplied to this run.", "Triggers", "Zap", [], [port("event", "any", "Input")], [field("sample", "Sample input", "textarea")]),
 ...[
  ["issue_opened", "Issue opened"], ["issue_labelled", "Issue labelled"], ["card_moved", "Card moved"], ["note_changed", "Note changed"],
 ].map(([id, label]) => node(`event.${id}`, "pipeline", label!, "Describe an event source. Studio runs use supplied input; automatic subscriptions belong to flows.", "Triggers", "Zap", [], [port("event", "event", "Event")], [field("filter", "Event filter")])),
 node("infer.request", "pipeline", "Request inference", "Ask a model to work on the input.", "Inference", "Cpu", [port("input", "any", "Input"), port("event", "event", "Trigger")], [port("text", "text", "Text")], [model, field("system", "System prompt", "textarea"), { ...field("prompt", "Prompt template", "textarea"), placeholder: "Review {{input}}" }], "engine"),
 node("infer.tidy", "pipeline", "Tidy text", "Clean up the input with a small model.", "Inference", "Cpu", input, [port("text", "text", "Text")], [model, field("prompt", "Instructions", "textarea")], "engine"),
 node("agent.spawn", "pipeline", "Ask an agent", "Plan a request to an agent definition. Requires the native agent lifecycle contract to execute.", "Agents", "Bot", input, [port("result", "text", "Result")], [field("template", "Agent template"), model, field("prompt", "Task", "textarea")], "engine"),
 node("agent.step", "pipeline", "Agent task", "Plan a tool-using agent task with explicit limits.", "Agents", "Bot", input, [port("result", "text", "Result")], [field("template", "Agent template"), model, field("prompt", "Task", "textarea"), field("tools", "Allowed tools"), field("maxTurns", "Maximum turns", "number")], "engine"),
 node("agent.wait", "pipeline", "Wait for agent", "Wait for an explicitly identified agent instance.", "Agents", "Bot", input, output, [field("instance", "Instance id"), field("timeout", "Timeout in seconds", "number")]),
 node("transform.template", "pipeline", "Template", "Build text from the input.", "Transform", "Shuffle", input, [port("text", "text", "Text")], [field("template", "Template", "textarea")]),
 node("transform.extract_json", "pipeline", "Extract JSON", "Read structured data from model output.", "Transform", "Shuffle", [port("text", "text", "Text")], [port("json", "json", "JSON")], [field("path", "JSON path")]),
 node("transform.merge", "pipeline", "Merge", "Combine the results of parallel branches.", "Transform", "Shuffle", [port("a", "any", "First"), port("b", "any", "Second"), port("c", "any", "Third")], [port("merged", "text", "Merged text")], [field("separator", "Separator")]),
 node("route.classify", "pipeline", "Classify", "Ask a question and route to a labelled branch.", "Route", "GitFork", input, [], [model, field("question", "Question", "textarea"), labels], "accent"),
 node("route.if", "pipeline", "Condition", "Choose yes or no from a condition.", "Route", "GitFork", input, [port("yes", "any", "Yes"), port("no", "any", "No")], [field("condition", "Condition", "textarea")]),
 node("route.fanout", "pipeline", "Fan out", "Send the input to several destinations.", "Route", "Route", input, [port("a", "any", "First"), port("b", "any", "Second"), port("c", "any", "Third")]),
 node("route.switch", "pipeline", "Switch on value", "Match the selected JSON value to a labelled output.", "Logic", "GitFork", input, [], [field("path", "Value path"), labels]),
 node("logic.join", "pipeline", "Join branches", "Collect all branches, or take the first connected result in edge order.", "Logic", "Shuffle", [port("a", "any", "First"), port("b", "any", "Second"), port("c", "any", "Third")], [port("output", "json", "Result")], [field("mode", "Collect", "select", ["all", "first"])]),
 node("logic.delay", "pipeline", "Wait", "Pause an explicitly executed run for a bounded duration.", "Logic", "Clock", input, output, [field("seconds", "Seconds, at most 60", "number")]),
 node("logic.approval", "pipeline", "Wait for approval", "Plan a human approval checkpoint. No approval is inferred during a preview.", "Logic", "ShieldCheck", input, [port("approved", "any"), port("rejected", "any"), port("timeout", "any")], [field("who", "Approver"), field("timeout", "Timeout in seconds", "number")]),
 ...[
  ["gate.if", "If value", "Route by truthiness without replacing the selected value."],
  ["gate.compare", "Compare values", "Compare typed JSON values, then pass the selected value to true or false."],
  ["gate.member", "Set membership", "Match a value against a typed JSON set without coercion."],
 ].map(([type, label, blurb]) => node(type!, "pipeline", label!, blurb!, "Logic", "GitFork", input, [port("true", "any", "True"), port("false", "any", "False")], [
  { ...field("path", "Envelope path as JSON", "textarea"), help: "For example [\"result\",\"value\",\"priority\"]. Each output retains its input envelopes." },
  ...(type === "gate.compare" ? [field("operator", "Comparison", "select", ["eq", "ne", "lt", "lte", "gt", "gte"]), field("right", "Compare with, as JSON", "textarea")] : type === "gate.member" ? [field("values", "Set values as JSON", "textarea")] : []),
 ])),
 node("operation.number", "pipeline", "Read number", "Read an exact numeric value for arithmetic. No string or boolean conversion.", "Transform", "Shuffle", input, [port("value", "any", "Number")], [field("path", "Envelope path as JSON", "textarea")]),
 node("operation.arithmetic", "pipeline", "Arithmetic", "Calculate with two numbers and retain both input envelopes.", "Transform", "Shuffle", [port("left", "any", "Left number"), port("right", "any", "Right number")], [port("value", "any", "Number")], [field("operator", "Operation", "select", ["add", "subtract", "multiply", "divide", "remainder", "power"])]),
 node("iteration.each", "pipeline", "For each item", "Run a bounded graph body once per item, with separate pass traces. Preview never writes.", "Logic", "Shuffle", input, [port("completed", "json", "Completed")], [field("path", "List envelope path as JSON", "textarea"), field("maxIterations", "Maximum items, at most 100", "number"), { ...field("body", "Native body graph as JSON", "textarea"), help: "Use exactly one iteration.input event source. See docs/graph-iteration.md for the body format and pass addresses." }]),
 node("logic.each", "pipeline", "List items", "Read the items of a JSON list as one collection. This does not repeat downstream actions.", "Logic", "Shuffle", [port("input", "json", "List")], [port("items", "json", "Items")], [field("path", "List path")]),
 node("logic.retry", "pipeline", "Retry plan", "Describe retries for a task. Preview does not repeat external work.", "Logic", "Route", input, output, [field("attempts", "Maximum attempts", "number"), field("delay", "Delay in seconds", "number")]),
 node("logic.stop", "pipeline", "Stop", "End this branch without sending output.", "Logic", "OctagonX", input, [], [field("message", "Run note")]),
 node("logic.fail", "pipeline", "Fail run", "Stop the run and record a failure.", "Logic", "OctagonX", input, [], [field("message", "Failure message")]),
 node("transform.set", "pipeline", "Set values", "Merge a JSON object into the incoming object.", "Transform", "Shuffle", input, [port("json", "json", "JSON")], [field("values", "Values as JSON", "textarea")]),
 node("transform.pick", "pipeline", "Pick value", "Read a dotted property path from the input.", "Transform", "Shuffle", input, [port("output", "any", "Value")], [field("path", "Property path")]),
 node("transform.filter", "pipeline", "Filter list", "Keep list items whose property equals the configured JSON value.", "Transform", "Shuffle", [port("input", "json", "List")], [port("json", "json", "Filtered list")], [field("path", "Item property path"), field("equals", "Equals, as JSON")]),
 node("transform.replace", "pipeline", "Replace text", "Replace every literal match in the input text.", "Transform", "Shuffle", input, [port("text", "text", "Text")], [field("search", "Find"), field("replacement", "Replace with")]),
 node("transform.split", "pipeline", "Split text", "Split text into a JSON list.", "Transform", "Shuffle", input, [port("json", "json", "List")], [field("separator", "Separator")]),
 node("transform.stringify", "pipeline", "JSON to text", "Format the input as readable JSON.", "Transform", "Shuffle", input, [port("text", "text", "Text")]),
 ...[
  ["comment_pr", "Comment on PR", "Post a review comment.", "comment", "Comment"], ["create_card", "Create card", "Create a card from an input object with title and body.", "stateId", "Column id, optional"], ["message_thread", "Message thread", "Send the result to a thread.", "thread", "Thread"], ["file_issue", "File issue", "Create an issue in a repository.", "repository", "Repository"], ["write_note", "Write note", "Save the result in Knowledge.", "path", "Note path"], ["http", "HTTP request", "Send the result to an endpoint.", "url", "URL"],
 ].map(([id, label, blurb, key, title]) => node(`out.${id}`, "pipeline", label!, blurb!, "Output", "Send", input, [], [field(key!, title!, id === "comment_pr" ? "textarea" : "text")])),
 ...[
  ["label_issue", "Label issue", "repository", "Repository"], ["request_review", "Request review", "reviewers", "Reviewers"], ["merge_pr", "Merge pull request", "repository", "Repository"], ["route_inbox", "Route inbox item", "destination", "Destination"], ["handle_inbox", "Mark inbox handled", "itemId", "Inbox item id"], ["move_card", "Move card", "stateId", "Destination column id"], ["assign_card", "Assign card", "template", "Agent template"], ["create_thread", "Create thread", "cwd", "Workspace"], ["append_note", "Append to note", "path", "Note path"], ["notify", "Notify", "channel", "Notification channel"],
 ].map(([id, label, key, title]) => node(`out.${id}`, "pipeline", label!, "Plan an explicit output action. Preview never dispatches it.", "Actions", "Send", input, [], [field(key!, title!), ...(id === "notify" ? [field("kind", "Notification kind", "select", ["task_shipped", "routine_failed", "auth_fallback"]), field("level", "Level", "select", ["info", "warn", "error", "critical"]), field("title", "Title")] : [])])),
 node("knowledge.search", "pipeline", "Search notes", "Plan an explicit knowledge search without injecting unrelated notes.", "Knowledge", "Search", input, [port("text", "text", "Matches")], [field("query", "Search query")]),
 node("router.entry", "router", "Virtual model", "The virtual model the request names.", "Routing", "Route", [], [port("request", "request", "Request")], [field("virtualModel", "Virtual model")]),
 node("router.stage", "router", "Model stage", "Draw from accounts, then demote when exhausted.", "Routing", "Database", [port("request", "request", "Request")], [port("next", "request", "Exhausted")], [model, { ...field("accounts", "Accounts"), help: "Use all or a comma-separated list of account names." }, field("draw", "Draw", "select", ["alternate", "least-used", "fill"]), field("perAccount", "Each account's pool", "percent"), field("cap", "Cap", "percent"), field("per", "Cap applies to", "select", ["user", "all"]), field("window", "Window", "select", ["5h", "day", "week", "month"]), field("effort", "Effort, optional")], "engine"),
 node("router.terminal", "router", "Terminal", "Limit, queue or pass through an exhausted request.", "Routing", "OctagonX", [port("request", "request", "Request")], [], [field("kind", "Outcome", "select", ["limit", "queue", "passthrough"]), field("message", "Message", "textarea"), { ...model, help: "The fallback model used by a passthrough terminal." }]),
 node("cls.input", "classifier", "Input", "Text to classify.", "Classifier", "Zap", [], [port("text", "text", "Text")], [field("sample", "Sample input", "textarea")]),
 node("cls.ask", "classifier", "Ask a model", "One question, with a branch for every label.", "Classifier", "HelpCircle", [port("text", "text", "Text")], [], [model, field("question", "Question", "textarea"), labels], "engine"),
 node("cls.rule", "classifier", "Match a rule", "Use a keyword or regular expression.", "Classifier", "GitFork", [port("text", "text", "Text")], [port("yes", "any", "Match"), port("no", "any", "No match")], [field("pattern", "Pattern"), field("regex", "Regular expression", "boolean")]),
 node("cls.examples", "classifier", "Classify from examples", "Ask the selected model to classify using labelled examples.", "Classifier", "HelpCircle", [port("text", "text", "Text")], [], [model, field("examples", "Labelled examples", "textarea"), labels], "engine"),
 node("cls.normalize", "classifier", "Normalize text", "Trim whitespace and optionally lowercase before matching.", "Classifier", "Shuffle", [port("text", "text", "Text")], [port("text", "text", "Text")], [field("lowercase", "Lowercase", "boolean")]),
 node("cls.switch", "classifier", "Exact match", "Route an exact text match to a label, or to unsure.", "Classifier", "GitFork", [port("text", "text", "Text")], [], [labels]),
 node("cls.output", "classifier", "Label", "Return this classification.", "Classifier", "Send", input, [], [field("label", "Label")]),
 node("bf.column", "boardflow", "Column", "A column cards pass through.", "Board flow", "KanbanSquare", input, output, [field("column", "Column name")]),
 node("bf.assign", "boardflow", "Assign an agent", "Plan assignment to an agent template. Instantiation requires the native agent lifecycle contract.", "Board flow", "Bot", input, output, [field("template", "Agent template"), model], "engine"),
 node("bf.gate", "boardflow", "Gate", "Wait for evidence before moving on.", "Board flow", "ShieldCheck", input, [port("yes", "any", "Pass"), port("no", "any", "Fail")], [field("condition", "Condition", "select", ["PR opened", "review passed", "tests pass"])]),
 node("bf.notify", "boardflow", "Notify", "Tell someone a card needs attention.", "Board flow", "Send", input, [], [field("who", "Who")]),
 node("bf.done", "boardflow", "Done", "The work has finished.", "Board flow", "ShieldCheck", input, []),
 node("bf.input", "boardflow", "Card input", "Start a manual board-flow run with a card-shaped input.", "Board flow", "KanbanSquare", [], [port("output", "any", "Card")], [field("sample", "Sample card as JSON", "textarea")]),
 node("bf.review", "boardflow", "Review work", "Plan review by an agent definition.", "Board flow", "Bot", input, output, [field("template", "Reviewer template"), model, field("instructions", "Review instructions", "textarea")], "engine"),
 node("bf.approval", "boardflow", "Owner approval", "Plan an owner decision before moving the card.", "Board flow", "ShieldCheck", input, [port("approved", "any"), port("rejected", "any"), port("timeout", "any")], [field("who", "Approver"), field("timeout", "Timeout in seconds", "number")]),
 node("bf.parallel", "boardflow", "Parallel work", "Send the same card to several explicit branches.", "Board flow", "GitFork", input, [port("a", "any", "First"), port("b", "any", "Second"), port("c", "any", "Third")]),
 node("bf.move", "boardflow", "Move card", "Move the supplied card to an existing board column on execute.", "Board flow", "KanbanSquare", input, output, [field("stateId", "Destination column id")]),
];
export const KIND_LABELS: Record<GraphKind, string> = { flow: "Flow", pipeline: "Pipeline", router: "Router", classifier: "Classifier", boardflow: "Board flow", map: "Map" };
export const BUILDABLE_KINDS: BuildableKind[] = ["flow", "pipeline", "router", "classifier", "boardflow"];
export function nodeType(type: string): NodeType | undefined { return NODE_TYPES.find(n => n.type === type); }
export function nodePorts(node: StudioNode): { inputs: Port[]; outputs: Port[] } {
 const type = nodeType(node.type);
 if (["route.classify", "route.switch", "cls.ask", "cls.examples", "cls.switch"].includes(node.type)) {
  const labels = String(node.config.labels ?? "yes,no").split(",").map(s => s.trim()).filter(Boolean);
  if (node.type.startsWith("cls.") && !labels.includes("unsure")) labels.push("unsure");
  return { inputs: type?.inputs ?? [], outputs: [...new Set(labels)].map(label => port(label, "any", label)) };
 }
 return { inputs: type?.inputs ?? [], outputs: type?.outputs ?? [] };
}
export function compatible(a: Port, b: Port): boolean { return a.type === b.type || a.type === "any" || b.type === "any"; }
export function defaultConfig(type: NodeType): Record<string, unknown> {
 const config: Record<string, unknown> = { name: type.label };
 for (const f of type.fields) config[f.key] = f.control === "boolean" ? false : f.control === "number" || f.control === "percent" ? 0 : f.control === "model" ? "@default" : f.options?.[0] ?? "";
 if (type.fields.some(f => f.key === "labels")) config.labels = "yes,no,unsure";
 if (["gate.if", "gate.compare", "gate.member", "operation.number", "iteration.each"].includes(type.type)) config.path = '["result","value"]';
 if (type.type === "gate.compare") config.right = "null";
 if (type.type === "gate.member") config.values = "[]";
 if (type.type === "iteration.each") {
  config.maxIterations = 100;
  config.body = JSON.stringify({ version: 2, nodes: [{ id: "item", type: "iteration.input", config: { eventType: "iteration" } }], edges: [] }, null, 2);
 }
 return config;
}

/** A planned node can be authored and safely inspected, but cannot dispatch work. */
const localTypes = new Set(["gate.if", "gate.compare", "gate.member", "operation.number", "operation.arithmetic", "iteration.each", "transform.template", "transform.extract_json", "transform.merge", "transform.set", "transform.pick", "transform.filter", "transform.replace", "transform.split", "transform.stringify", "route.if", "route.switch", "route.fanout", "logic.join", "logic.each", "logic.delay", "logic.stop", "logic.fail", "cls.input", "cls.rule", "cls.normalize", "cls.switch", "cls.output", "bf.input", "bf.column", "bf.gate", "bf.parallel", "bf.done"]);
const actionTypes = new Set(["out.create_card", "out.file_issue", "out.notify", "out.move_card", "out.handle_inbox", "bf.move"]);
export function studioNodeExecution(type: string): "local" | "action" | "preview" {
 return type.startsWith("event.") || localTypes.has(type) ? "local" : actionTypes.has(type) ? "action" : "preview";
}
