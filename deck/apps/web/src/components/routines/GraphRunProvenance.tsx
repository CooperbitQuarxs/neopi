import { useMemo, useState, type ReactNode } from "react";
import type { GraphNodeRun, GraphOutput, GraphRunRecord, GraphValue } from "@npi-deck/protocol";
import { derivedInputEdges, iterationLabel, nodeOutcome, occurrenceKey, producingOccurrence, runOccurrences, snapshotNodeTitle, valueDescription, type RunOccurrence } from "./graph-run-provenance";
import "./graph-run-provenance.css";

function Branch({ label, children, initiallyOpen = false, path }: { label: ReactNode; children: () => ReactNode; initiallyOpen?: boolean; path: string }) {
	const [open, setOpen] = useState(initiallyOpen);
	return <div className="graph-provenance-branch" data-occurrence={path}>
		<button type="button" className="graph-provenance-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><span aria-hidden="true">{open ? "▾" : "▸"}</span><span>{label}</span></button>
		{open ? <div className="graph-provenance-children">{children()}</div> : null}
	</div>;
}

/** Keep result objects intact. A property named value is not an unwrapping hint. */
export function GraphValueTree({ value, label, path, initiallyOpen = false }: { value: GraphValue; label: string; path: string; initiallyOpen?: boolean }) {
	const description = valueDescription(value);
	const heading = <><strong>{label}</strong> <small>{description.type}</small> <code>{description.text}</code></>;
	if (value === null || typeof value !== "object" || Object.keys(value).length === 0) return <div className="graph-provenance-value" data-occurrence={path}>{heading}</div>;
	return <Branch path={path} label={heading} initiallyOpen={initiallyOpen}>{() => Object.entries(value).map(([key, child], index) => <GraphValueTree key={occurrenceKey(path, "properties", index)} path={occurrenceKey(path, "properties", index)} label={Array.isArray(value) ? `[${key}]` : key} value={child} />)}</Branch>;
}

interface TraceContext { trace: GraphRunRecord; occurrences: RunOccurrence[] }

function InputTree({ output, index, consumer, path, context, extra = false }: { output: GraphOutput; index: number; consumer?: RunOccurrence; path: string; context: TraceContext; extra?: boolean }) {
	const port = consumer?.run.inputPorts[index];
	const edge = consumer && !extra ? derivedInputEdges(consumer)[index] : undefined;
	return <div className="graph-provenance-input">
		<p className="graph-provenance-note">{extra ? "Iteration body output retained by the iterator. Not a wired input." : <>Input {index + 1}, consuming port <code>{port ?? "unavailable"}</code>. {edge ? <>Connection <code>{edge.id}</code>, derived from snapshot edge and emission order.</> : "Connection association unavailable. No edge ID is stored on this input."}</>}</p>
		<OutputTree output={output} path={path} context={context} />
	</div>;
}

function OutputTree({ output, path, context }: { output: GraphOutput; path: string; context: TraceContext }) {
	const producer = producingOccurrence(context.occurrences, output);
	const node = producer?.graph?.nodes.find(candidate => candidate.id === output.nodeId);
	return <Branch path={path} label={<><strong>{snapshotNodeTitle(node, output.nodeId)}</strong> <code>{output.nodeId}.{output.port}</code>{output.iteration?.length ? <small>{iterationLabel(output.iteration)}</small> : null}</>} initiallyOpen>{() => <>
		<GraphValueTree label="Result" value={output.result} path={`${path}/result`} initiallyOpen />
		{output.inputs.length ? <Branch label={`Inputs, ${output.inputs.length} in recorded order`} path={`${path}/inputs`}>{() => output.inputs.map((input, index) => <InputTree key={occurrenceKey(path, "inputs", index)} output={input} index={index} consumer={producer} extra={!!producer && index >= producer.run.inputs.length} path={occurrenceKey(path, "inputs", index)} context={context} />)}</Branch> : <>
			<p className="graph-provenance-note">No upstream inputs. This output begins at a source event.</p>
			<GraphValueTree label="Original activation" value={context.trace.activation.event} path={`${path}/activation`} />
		</>}
	</>}</Branch>;
}

function containsNode(run: GraphNodeRun, nodeId: string): boolean {
	return run.nodeId === nodeId || !!run.passes?.some(pass => pass.nodeRuns.some(child => containsNode(child, nodeId)));
}

function NodeTree({ occurrence, context, selectedNode }: { occurrence: RunOccurrence; context: TraceContext; selectedNode?: string }) {
	const { run, key, graph } = occurrence;
	const node = graph?.nodes.find(candidate => candidate.id === run.nodeId);
	return <Branch path={key} initiallyOpen={!!selectedNode && containsNode(run, selectedNode)} label={<><i className="graph-provenance-status" data-status={run.status} /><strong>{snapshotNodeTitle(node, run.nodeId)}</strong><small>{nodeOutcome(run)}</small>{run.iteration?.length ? <code>{iterationLabel(run.iteration)}</code> : null}</>}>{() => <>
		<p className="graph-provenance-note"><code>{run.nodeId}</code>, stored type <code>{node?.type ?? run.type}</code></p>
		{run.error ? <p className="graph-provenance-error" role="alert">{run.error}</p> : null}
		{run.status === "skipped" ? <p className="graph-provenance-note">An inactive branch does not produce a false result. This node was not invoked. The trace does not record a more specific skip reason.</p> : null}
		{node ? <GraphValueTree label="Configuration at execution" value={node.config} path={`${key}/config`} /> : <p className="graph-provenance-note">This node's configuration is unavailable in the stored snapshot.</p>}
		{run.outputs.length ? run.outputs.map((output, index) => <OutputTree key={occurrenceKey(key, "outputs", index)} output={output} path={occurrenceKey(key, "outputs", index)} context={context} />) : <p className="graph-provenance-note">{run.status === "success" ? "Successful execution with zero outputs. No downstream branch was activated by this node." : "No output was emitted."}</p>}
		{run.inputs.length ? <Branch label={`Recorded node inputs, ${run.inputs.length}`} path={`${key}/node-inputs`}>{() => run.inputs.map((input, index) => <InputTree key={occurrenceKey(key, "node-inputs", index)} output={input} index={index} consumer={occurrence} path={occurrenceKey(key, "node-inputs", index)} context={context} />)}</Branch> : null}
		{run.passes ? <Branch label={`Iteration passes, ${run.passes.length}`} path={`${key}/passes`} initiallyOpen={!!selectedNode}>{() => run.passes!.length ? run.passes!.map((pass, passIndex) => {
			const passPath = occurrenceKey(key, "passes", passIndex);
			return <Branch key={passPath} path={passPath} label={<>Pass {pass.index}, zero-based <small>{pass.status}, {pass.outputs.length} outputs</small></>} initiallyOpen={!!selectedNode}>{() => <>
				{pass.nodeRuns.map((child, childIndex) => {
					if (selectedNode && selectedNode !== run.nodeId && !containsNode(child, selectedNode)) return null;
					const childOccurrence = context.occurrences.find(item => item.key === occurrenceKey(passPath, "nodes", childIndex));
					return childOccurrence ? <NodeTree key={childOccurrence.key} occurrence={childOccurrence} context={context} selectedNode={selectedNode} /> : null;
				})}
				<Branch label={`Pass outputs, ${pass.outputs.length} in recorded order`} path={`${passPath}/outputs`}>{() => pass.outputs.map((output, index) => <OutputTree key={occurrenceKey(passPath, "outputs", index)} output={output} path={occurrenceKey(passPath, "outputs", index)} context={context} />)}</Branch>
			</>}</Branch>;
		}) : <p className="graph-provenance-note">Zero passes were recorded. An empty collection can complete successfully without invoking the body.</p>}</Branch> : null}
		{run.diagnostics ? <GraphValueTree label="Execution details" value={run.diagnostics} path={`${key}/diagnostics`} /> : null}
		{run.effects ? <Branch label={`Recorded effects, ${run.effects.length}`} path={`${key}/effects`}>{() => run.effects!.map((effect, index) => <GraphValueTree key={occurrenceKey(key, "effects", index)} label={`${effect.status}, ${effect.logicalKey}`} value={{ ...effect }} path={occurrenceKey(key, "effects", index)} />)}</Branch> : null}
	</>}</Branch>;
}

/** Historical inspection never needs the current routine or a live catalogue. */
export function GraphRunProvenance({ trace, nodeId }: { trace: GraphRunRecord; nodeId?: string }) {
	const context = useMemo(() => ({ trace, occurrences: runOccurrences(trace) }), [trace]);
	const roots = trace.nodeRuns.map((_, index) => context.occurrences.find(item => item.key === occurrenceKey(trace.id, "nodes", index))!).filter(item => !nodeId || containsNode(item.run, nodeId));
	return <section className="graph-provenance" aria-label={nodeId ? `Run provenance for ${nodeId}` : "Run provenance"} key={`${trace.id}/${nodeId ?? "all"}`}>
		<p className="graph-provenance-note">{trace.dryRun ? "Preview. " : ""}Stored execution snapshot. Expand an output's inputs to follow its ancestry. Pass indexes are zero-based.</p>
		<p className="graph-provenance-outcome" data-status={trace.status}>{trace.status === "success" ? "Run succeeded" : trace.status === "aborted" ? "Run aborted" : "Run failed"}{trace.abortReason ? `, ${trace.abortReason}` : ""}</p>
		{trace.error ? <p className="graph-provenance-error" role="alert">{trace.error}</p> : null}
		<Branch label={<>Activation <code>{trace.activation.eventType}</code></>} path={`${trace.id}/activation`}>{() => <>
			{trace.activation.sourceNodeId ? <p className="graph-provenance-note">Selected source <code>{trace.activation.sourceNodeId}</code></p> : null}
			{trace.activation.operationId ? <p className="graph-provenance-note">Operation <code>{trace.activation.operationId}</code></p> : null}
			<GraphValueTree label="Original event" value={trace.activation.event} path={`${trace.id}/activation/event`} initiallyOpen />
		</>}</Branch>
		{roots.length ? roots.map(occurrence => <NodeTree key={occurrence.key} occurrence={occurrence} context={context} selectedNode={nodeId} />) : <p className="graph-provenance-note">{nodeId ? "No execution occurrence for this node is present in the trace." : "No node executions were recorded."}</p>}
	</section>;
}
