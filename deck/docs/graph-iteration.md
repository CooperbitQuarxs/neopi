# Graph gates, arithmetic and bounded iteration

Native routines and Studio use the same graph executor and node registry. Node outputs retain `result` and the upstream `inputs` envelopes. Objects remain objects under `result`; arrays, numbers, strings, booleans and null are wrapped as `result.value`.

## Gates and operations

`gate.if`, `gate.compare` and `gate.member` receive one `input` envelope. Their `path` configuration is an array of own-property keys into that envelope, such as `["result","priority"]` for an event object or `["result","value"]` for a scalar. Missing properties fail the node. No expressions are evaluated.

Each gate emits on exactly one port, `true` or `false`. The emitted value is the exact selected value, not the predicate boolean. A truthy string therefore stays distinguishable from literal `true`. Both branch consumers retain the original gate input envelope. A branch that did not emit never invokes its consumers. Required descendants of an inactive branch skip; optional inactive inputs do not block another active input.

- `gate.if` uses JSON values' JavaScript truthiness. `false`, `0`, `""` and null select `false`. Nonempty strings, nonzero numbers, arrays and objects select `true`, including empty arrays and objects.
- `gate.compare` takes `operator` and a JSON `right` literal. `eq` and `ne` compare types and structure without conversion. Object key order is irrelevant; array order matters. `lt`, `lte`, `gt` and `gte` require two numbers or two strings. Strings use JavaScript's lexicographic UTF-16 ordering. Mixed types and other ordered operands fail.
- `gate.member` takes a JSON array `values` and uses the same typed structural equality. `1`, `"1"` and `true` are distinct members.
- `operation.pick` emits the selected value on `value`. Its universal output port accepts every JSON value.
- `operation.number` selects a number and exposes a typed numeric `value` port. Numeric strings, booleans and null fail instead of converting.
- `operation.arithmetic` has required numeric `left` and `right` inputs and numeric `value` output. Operators are `add`, `subtract`, `multiply`, `divide`, `remainder` and `power`. These use finite IEEE-754 JavaScript numbers. Division and remainder by zero fail. Overflow and nonfinite results fail. Both original numeric input envelopes remain in output provenance.

Static typed-port validation rejects connecting universal or nonnumeric outputs directly to arithmetic. Use `operation.number` to select a numeric event field first. The registry validates configurations, including those inside bodies, before any node executes.

## Iteration representation

`iteration.each` receives one `input`, selects an array using `config.path`, and executes `config.body` once for every array item in index order. The body is a version-2 graph with its own node and edge namespace. It must have exactly one `iteration.input` source with `config.eventType = "iteration"`. Other event sources, arbitrary dependency cycles and body-local concurrency, budgets, tags or timezone are rejected.

The body source emits on `item`, with `result = { item, index, count }`. Its `inputs` are the iterator's original input envelopes. Every body output can therefore reach both the exact current item and the original outer event. Nested gates keep that chain rather than replacing it with a branch boolean.

A minimal iterator connected to an `event.source` might use this configuration:

```json
{
  "path": ["result", "items"],
  "maxIterations": 100,
  "body": {
    "version": 2,
    "nodes": [
      { "id": "item", "type": "iteration.input", "config": { "eventType": "iteration" } },
      { "id": "gate", "type": "gate.if", "config": { "path": ["result", "item"] } }
    ],
    "edges": [
      { "id": "item-gate", "from": { "nodeId": "item", "port": "item" }, "to": { "nodeId": "gate", "port": "input" } }
    ]
  }
}
```

Studio's For each item node accepts this native body graph as JSON in its inspector. Its default path is `["result","value"]`, because Studio source samples are wrapped values. The existing List items node still returns a collection once; it does not repeat downstream work. Add work to the For each item body to repeat it. Gates, Read number and Arithmetic are also available in the canvas node library.

## Pass addresses and completion

Each body output and node-run record includes `iteration`, an outer-to-inner array of `{ nodeId, index }` entries. Indexes are zero-based. Node IDs may repeat in different bodies or passes without ambiguity. For example, `[{"nodeId":"outer","index":2},{"nodeId":"inner","index":0}]` selects inner pass zero in outer pass two.

The iterator node-run record contains `passes[index]`, with that pass's `status`, `nodeRuns` and exact `outputs`. Nested iterator records keep nested passes. `findGraphOutput(output, nodeId, port, iteration)` can select an exact address after JSON persistence; ordinary own-key paths can traverse the same trace.

After every pass succeeds, the iterator emits `completed` with `result = { count, completed: true }`. Its input envelopes include the original iterator inputs followed by the actual body outputs in pass and node order. An empty array succeeds with `count: 0`, `passes: []`, no body invocations and the original input provenance. It is not an inactive branch.

A failure or abort emits no `completed` output. Completed passes, the interrupted pass's available outputs and its failure/abort status remain in the iterator record. Later passes do not execute. The run is failed or aborted, never a successful partial result. Native persisted run records also retain the executed graph snapshot, so later edits cannot change the meaning of a historical body trace.

## Limits and side effects

- `maxIterations` is an integer from 1 through 100. An array with more items fails before its first body pass, not after a successful-looking prefix. Exactly the configured finite count succeeds.
- Up to four iterator levels may nest. The entire body tree and its ports are validated before any execution.
- Run-wide duration, steps, input/output tokens and cost budgets apply across all bodies and passes. The iterator itself and every executed body source and body node count as steps. Skipped nodes do not. A cap is not reset when a pass starts.
- Studio runs use one 120-second duration cap and a 10,000-step cap, including their iteration bodies.
- The existing run cancellation signal reaches active body nodes. Cancellation or a budget stopping logical completion preserves completed-pass evidence and records an aborted run.
- Actions include the original trigger event type and full pass address in their durable operation identity. Identity keeps the ordinary explicit operation ID, event ID, then event.card.id precedence. Iteration does not require a new explicit operation ID: the executor retains the original activation separately from the current pass event. Two passes with the same action node ID are distinct operations; a retry of that same pass retains its identity.
- Preview carries `dryRun` through every pass. Supported action nodes plan effects without dispatching or writing domain state. Studio's body registry has no inference executor. Explicit execution remains required for actions.

Existing persisted-trace size and privacy bounds still apply. Iteration does not remove those limits or invent missing work when a trace is too large to persist.
